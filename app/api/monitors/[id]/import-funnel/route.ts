/**
 * POST /api/monitors/[id]/import-funnel
 *
 * Accepts a JSON array of funnel steps and bulk-inserts them for the given
 * monitor, replacing any previously stored steps.
 *
 * Request body: FunnelStepInput[]
 *   [{ actionType: "navigate"|"click"|"fill"|"wait"|"submit", payload: {...} }, ...]
 *
 * Requires: authenticated session, user must own the monitor.
 * Rate-limited: 10 requests per minute per user.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { funnelStep, monitor, actionTypeEnum } from "@/lib/db/schema";
import { ApiError, handleRoute } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
import { and, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const funnelStepInputSchema = z.object({
  actionType: z.enum(actionTypeEnum.enumValues, {
    message: `actionType must be one of: ${actionTypeEnum.enumValues.join(", ")}`,
  }),
  payload: z.record(z.string(), z.unknown()),
});

const importBodySchema = z
  .array(funnelStepInputSchema)
  .min(1, "At least one step is required");

// ---------------------------------------------------------------------------
// Route params type — Next.js 15+ passes params as a Promise
// ---------------------------------------------------------------------------

type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const POST = handleRoute(
  async (req: NextRequest, ctx: RouteContext): Promise<Response> => {
    // 1. Auth check (real session via Node runtime — not edge-safe)
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      throw new ApiError("unauthorized", "You must be signed in.");
    }

    const userId = session.user.id;

    // 2. Rate-limit: 10 imports per minute per user
    const rl = rateLimit(`import:${userId}`, 10, 60_000);
    if (rl.limited) {
      throw new ApiError(
        "rate_limited",
        "Too many import requests. Please wait before trying again.",
      );
    }

    // 3. Extract monitor ID from route params
    const { id: monitorId } = await ctx.params;

    // 4. Parse + validate body
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      throw new ApiError("bad_request", "Request body must be valid JSON.");
    }

    const parsed = importBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      throw new ApiError(
        "bad_request",
        firstIssue?.message ?? "Invalid request body.",
      );
    }

    const steps = parsed.data;

    // 5. Verify the monitor exists and belongs to the authenticated user
    const [existingMonitor] = await db
      .select({ id: monitor.id, userId: monitor.userId })
      .from(monitor)
      .where(eq(monitor.id, monitorId));

    if (!existingMonitor) {
      throw new ApiError("not_found", `Monitor '${monitorId}' not found.`);
    }

    if (existingMonitor.userId !== userId) {
      throw new ApiError(
        "forbidden",
        "You do not have permission to modify this monitor.",
      );
    }

    // 6. Replace funnel steps atomically: delete old rows then bulk-insert new ones
    await db.transaction(async (tx) => {
      // Remove all existing steps for this monitor
      await tx.delete(funnelStep).where(eq(funnelStep.monitorId, monitorId));

      if (steps.length > 0) {
        await tx.insert(funnelStep).values(
          steps.map((step, index) => ({
            id: crypto.randomUUID(),
            monitorId,
            stepOrder: index,
            actionType:
              step.actionType as (typeof funnelStep.$inferInsert)["actionType"],
            payload: step.payload,
          })),
        );
      }
    });

    return NextResponse.json({ imported: steps.length }, { status: 201 });
  },
);
