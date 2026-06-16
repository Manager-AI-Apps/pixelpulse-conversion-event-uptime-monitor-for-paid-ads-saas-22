/**
 * Data-access functions for the `monitor` table.
 *
 * All queries are scoped to the calling user's `userId` so that one user can
 * never read or mutate another user's monitors.  Pass `db` explicitly in tests
 * (createTestDb().db) and rely on the default `db` import in production.
 */

import { and, eq } from "drizzle-orm";

import { db as defaultDb } from "@/lib/db";
import type { Database } from "@/lib/db";
import { monitor } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Thrown when an operation is attempted on a resource the caller doesn't own. */
export class AuthorizationError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateMonitorInput {
  userId: string;
  name: string;
  url: string;
  intervalMinutes?: number;
  slackWebhookUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Insert a new monitor for `userId`.  Returns the newly-created row.
 */
export async function createMonitor(
  db: Database = defaultDb,
  input: CreateMonitorInput,
): Promise<typeof monitor.$inferSelect> {
  if (!input.userId) throw new Error("userId is required");
  if (!input.name.trim()) throw new Error("name is required");
  if (!input.url.trim()) throw new Error("url is required");

  const [created] = await db
    .insert(monitor)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      name: input.name.trim(),
      url: input.url.trim(),
      intervalMinutes: input.intervalMinutes ?? 15,
      slackWebhookUrl: input.slackWebhookUrl ?? null,
    })
    .returning();

  if (!created) throw new Error("Failed to insert monitor");
  return created;
}

/**
 * Return all monitors owned by `userId`, ordered by creation time (newest first).
 */
export async function listMonitors(
  db: Database = defaultDb,
  userId: string,
): Promise<(typeof monitor.$inferSelect)[]> {
  return db.select().from(monitor).where(eq(monitor.userId, userId));
}

/**
 * Return the monitor with `id` only if it is owned by `userId`, or `null`
 * if it does not exist or belongs to a different user.
 */
export async function getMonitor(
  db: Database = defaultDb,
  id: string,
  userId: string,
): Promise<typeof monitor.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(monitor)
    .where(and(eq(monitor.id, id), eq(monitor.userId, userId)));

  return row ?? null;
}

/**
 * Delete a monitor.  Throws `AuthorizationError` when the monitor exists but
 * is owned by a different user; also throws when the monitor does not exist
 * (to avoid leaking whether the id is valid).
 */
export async function deleteMonitor(
  db: Database = defaultDb,
  id: string,
  userId: string,
): Promise<void> {
  // Fetch without scoping to userId so we can distinguish "not found" vs
  // "wrong owner" — both cases surface as AuthorizationError to the caller.
  const [row] = await db
    .select({ id: monitor.id, userId: monitor.userId })
    .from(monitor)
    .where(eq(monitor.id, id));

  if (!row || row.userId !== userId) {
    throw new AuthorizationError(
      "Monitor not found or you do not have permission to delete it",
    );
  }

  await db.delete(monitor).where(eq(monitor.id, id));
}
