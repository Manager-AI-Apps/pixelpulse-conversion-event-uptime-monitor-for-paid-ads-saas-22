"use server";

/**
 * Server actions for monitor CRUD operations.
 *
 * Validate all inputs with zod, check session, then delegate to data-access
 * queries. Returns typed result objects — never throws — so callers can pattern
 * match on `"error" in result`.
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createMonitor, deleteMonitor } from "@/lib/queries/monitors";
import type { monitor } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createMonitorSchema = z.object({
  name: z.string().min(1, "Monitor name is required"),
  siteUrl: z
    .string()
    .min(1, "Site URL is required")
    .url("Site URL must be a valid URL"),
  slackWebhookUrl: z
    .string()
    .min(1, "Slack webhook URL is required")
    .url("Slack webhook URL must be a valid URL"),
  intervalMinutes: z.number().int().min(1).max(60).optional().default(15),
});

const deleteMonitorSchema = z.object({
  monitorId: z.string().min(1, "Monitor ID is required"),
});

export type CreateMonitorInput = z.input<typeof createMonitorSchema>;

// ---------------------------------------------------------------------------
// createMonitorAction
// ---------------------------------------------------------------------------

export type CreateMonitorResult =
  | { error: string }
  | { monitor: Pick<typeof monitor.$inferSelect, "id" | "name" | "url" | "status"> };

/**
 * Create a new monitor for the currently signed-in user.
 */
export async function createMonitorAction(
  input: CreateMonitorInput,
): Promise<CreateMonitorResult> {
  // 1. Validate input first — cheap; runs before any IO.
  const parsed = createMonitorSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // 2. Verify session.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { error: "You must be signed in to create a monitor" };
  }

  // 3. Persist.
  const created = await createMonitor(db, {
    userId: session.user.id,
    name: parsed.data.name,
    url: parsed.data.siteUrl,
    intervalMinutes: parsed.data.intervalMinutes,
    slackWebhookUrl: parsed.data.slackWebhookUrl,
  });

  revalidatePath("/dashboard");

  return {
    monitor: {
      id: created.id,
      name: created.name,
      url: created.url,
      status: created.status,
    },
  };
}

// ---------------------------------------------------------------------------
// deleteMonitorAction
// ---------------------------------------------------------------------------

export type DeleteMonitorResult = { error: string } | { success: true };

/**
 * Delete a monitor owned by the currently signed-in user.
 * Throws `AuthorizationError` from the query layer when ownership check fails.
 */
export async function deleteMonitorAction(input: {
  monitorId: string;
}): Promise<DeleteMonitorResult> {
  // 1. Validate input.
  const parsed = deleteMonitorSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // 2. Verify session.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { error: "You must be signed in to delete a monitor" };
  }

  // 3. Delete (query enforces ownership).
  try {
    await deleteMonitor(db, parsed.data.monitorId, session.user.id);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete monitor";
    return { error: message };
  }

  revalidatePath("/dashboard");

  return { success: true };
}
