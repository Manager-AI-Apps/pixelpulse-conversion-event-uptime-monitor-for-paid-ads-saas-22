/**
 * Data-access functions for funnel steps and event assertions.
 *
 * All mutating functions that operate on event assertions verify that the
 * requesting user owns the parent monitor (authorization lives here, not in RLS).
 * Pass `db` explicitly in tests; rely on the default `db` import in production.
 */

import { count, eq } from "drizzle-orm";
import { z } from "zod";

import { db as defaultDb } from "@/lib/db";
import type { Database } from "@/lib/db";
import {
  eventAssertion,
  funnelStep,
  monitor,
  actionTypeEnum,
  platformEnum,
} from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Thrown when a user attempts an operation on a resource they do not own. */
export class AuthorizationError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const addFunnelStepSchema = z.object({
  monitorId: z.string().min(1, "monitorId is required"),
  actionType: z.enum(actionTypeEnum.enumValues),
  payload: z.record(z.string(), z.unknown()),
  /** If omitted, auto-assigned as MAX(stepOrder)+1 for the monitor (0-based). */
  stepOrder: z.number().int().min(0).optional(),
});

const addEventAssertionSchema = z.object({
  funnelStepId: z.string().min(1, "funnelStepId is required"),
  platform: z.enum(platformEnum.enumValues),
  eventName: z.string().min(1, "eventName is required"),
  expectedCurrency: z.string().optional(),
  expectedProps: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export type AddFunnelStepInput = z.input<typeof addFunnelStepSchema>;
export type AddEventAssertionInput = z.input<typeof addEventAssertionSchema>;

// ---------------------------------------------------------------------------
// addFunnelStep
// ---------------------------------------------------------------------------

/**
 * Insert a new funnel step for a monitor.
 *
 * Validates `actionType` with Zod — throws `ZodError` for unknown action types.
 * If `stepOrder` is omitted, it is auto-assigned as the next sequential index
 * (0-based) for the monitor.
 */
export async function addFunnelStep(
  db: Database = defaultDb,
  input: AddFunnelStepInput,
): Promise<typeof funnelStep.$inferSelect> {
  // Parse + validate — throws ZodError on failure.
  const parsed = addFunnelStepSchema.parse(input);

  let resolvedOrder = parsed.stepOrder;
  if (resolvedOrder === undefined) {
    // Count existing steps to derive the next 0-based index.
    const [result] = await db
      .select({ total: count() })
      .from(funnelStep)
      .where(eq(funnelStep.monitorId, parsed.monitorId));
    resolvedOrder = result?.total ?? 0;
  }

  const [created] = await db
    .insert(funnelStep)
    .values({
      id: crypto.randomUUID(),
      monitorId: parsed.monitorId,
      stepOrder: resolvedOrder,
      actionType: parsed.actionType as typeof funnelStep.$inferInsert["actionType"],
      payload: parsed.payload,
    })
    .returning();

  if (!created) throw new Error("Failed to insert funnel step");
  return created;
}

// ---------------------------------------------------------------------------
// deleteFunnelStep
// ---------------------------------------------------------------------------

/**
 * Delete a funnel step.
 *
 * Verifies that the step's parent monitor belongs to `userId`; throws
 * `AuthorizationError` otherwise (including when the step does not exist).
 */
export async function deleteFunnelStep(
  db: Database = defaultDb,
  stepId: string,
  userId: string,
): Promise<void> {
  const [row] = await db
    .select({
      stepId: funnelStep.id,
      ownerId: monitor.userId,
    })
    .from(funnelStep)
    .innerJoin(monitor, eq(funnelStep.monitorId, monitor.id))
    .where(eq(funnelStep.id, stepId));

  if (!row || row.ownerId !== userId) {
    throw new AuthorizationError(
      "Funnel step not found or you do not have permission to delete it",
    );
  }

  await db.delete(funnelStep).where(eq(funnelStep.id, stepId));
}

// ---------------------------------------------------------------------------
// addEventAssertion
// ---------------------------------------------------------------------------

/**
 * Insert a new event assertion attached to a funnel step.
 *
 * Verifies that the funnel step's parent monitor belongs to `userId`; throws
 * `AuthorizationError` for wrong ownership or unknown step IDs.
 */
export async function addEventAssertion(
  db: Database = defaultDb,
  userId: string,
  input: AddEventAssertionInput,
): Promise<typeof eventAssertion.$inferSelect> {
  // Parse + validate.
  const parsed = addEventAssertionSchema.parse(input);

  // Verify ownership: funnelStep → monitor → userId.
  const [row] = await db
    .select({ ownerId: monitor.userId })
    .from(funnelStep)
    .innerJoin(monitor, eq(funnelStep.monitorId, monitor.id))
    .where(eq(funnelStep.id, parsed.funnelStepId));

  if (!row || row.ownerId !== userId) {
    throw new AuthorizationError(
      "Funnel step not found or you do not have permission to add assertions to it",
    );
  }

  const [created] = await db
    .insert(eventAssertion)
    .values({
      id: crypto.randomUUID(),
      funnelStepId: parsed.funnelStepId,
      platform: parsed.platform as typeof eventAssertion.$inferInsert["platform"],
      eventName: parsed.eventName,
      expectedCurrency: parsed.expectedCurrency ?? null,
      expectedProps: parsed.expectedProps ?? null,
    })
    .returning();

  if (!created) throw new Error("Failed to insert event assertion");
  return created;
}

// ---------------------------------------------------------------------------
// deleteEventAssertion
// ---------------------------------------------------------------------------

/**
 * Delete an event assertion.
 *
 * Verifies that the assertion's step's monitor belongs to `userId`; throws
 * `AuthorizationError` otherwise.
 */
export async function deleteEventAssertion(
  db: Database = defaultDb,
  assertionId: string,
  userId: string,
): Promise<void> {
  const [row] = await db
    .select({ ownerId: monitor.userId })
    .from(eventAssertion)
    .innerJoin(funnelStep, eq(eventAssertion.funnelStepId, funnelStep.id))
    .innerJoin(monitor, eq(funnelStep.monitorId, monitor.id))
    .where(eq(eventAssertion.id, assertionId));

  if (!row || row.ownerId !== userId) {
    throw new AuthorizationError(
      "Event assertion not found or you do not have permission to delete it",
    );
  }

  await db.delete(eventAssertion).where(eq(eventAssertion.id, assertionId));
}

// ---------------------------------------------------------------------------
// Read queries
// ---------------------------------------------------------------------------

/**
 * Return all funnel steps for a monitor, ordered by stepOrder ascending.
 * Does not enforce ownership — callers must scope to the user's monitor.
 */
export async function listFunnelSteps(
  db: Database = defaultDb,
  monitorId: string,
): Promise<(typeof funnelStep.$inferSelect)[]> {
  return db
    .select()
    .from(funnelStep)
    .where(eq(funnelStep.monitorId, monitorId))
    .orderBy(funnelStep.stepOrder);
}

/**
 * Return all event assertions for a funnel step.
 */
export async function listEventAssertions(
  db: Database = defaultDb,
  funnelStepId: string,
): Promise<(typeof eventAssertion.$inferSelect)[]> {
  return db
    .select()
    .from(eventAssertion)
    .where(eq(eventAssertion.funnelStepId, funnelStepId));
}

/**
 * Return all event assertions for every step belonging to a monitor.
 * Useful for the detail page to load all assertions in one query.
 */
export async function listEventAssertionsByMonitor(
  db: Database = defaultDb,
  monitorId: string,
): Promise<(typeof eventAssertion.$inferSelect)[]> {
  return db
    .select({
      id: eventAssertion.id,
      funnelStepId: eventAssertion.funnelStepId,
      platform: eventAssertion.platform,
      eventName: eventAssertion.eventName,
      expectedCurrency: eventAssertion.expectedCurrency,
      expectedProps: eventAssertion.expectedProps,
      createdAt: eventAssertion.createdAt,
    })
    .from(eventAssertion)
    .innerJoin(funnelStep, eq(eventAssertion.funnelStepId, funnelStep.id))
    .where(eq(funnelStep.monitorId, monitorId));
}
