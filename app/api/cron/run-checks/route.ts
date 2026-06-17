/**
 * POST /api/cron/run-checks
 *
 * Cron trigger: inserts pending check_run rows for every active, due monitor
 * (nextRunAt IS NULL OR nextRunAt <= now). Does NOT run Playwright — that is
 * the separate Render worker service's responsibility.
 *
 * Authorization: expects the header
 *   Authorization: Bearer <CRON_SECRET>
 *
 * The CRON_SECRET is injected via Render's env var at deploy time and set on
 * the Render cron job that calls this endpoint. Requests missing or providing
 * an incorrect secret are rejected with 401.
 */

import { NextRequest, NextResponse } from "next/server";

import { ApiError, handleRoute } from "@/lib/api-error";
import { db } from "@/lib/db";
import { requireEnv } from "@/lib/env";
import { schedulePendingRuns } from "@/lib/worker/index";

/** GET /api/cron/run-checks — health / existence check (no auth required). */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ ok: true, endpoint: "run-checks" });
}

export const POST = handleRoute(async (req: NextRequest): Promise<NextResponse> => {
  // Validate CRON_SECRET — read inside the handler so startup never throws
  const cronSecret = requireEnv("CRON_SECRET");

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token || token !== cronSecret) {
    throw new ApiError("unauthorized", "Invalid or missing CRON_SECRET.");
  }

  const created = await schedulePendingRuns(db);

  return NextResponse.json({ ok: true, created });
});
