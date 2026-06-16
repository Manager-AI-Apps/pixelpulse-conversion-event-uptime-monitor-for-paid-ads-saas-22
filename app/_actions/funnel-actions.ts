"use server";

/**
 * Server actions for funnel step and event assertion CRUD operations.
 *
 * All actions:
 * 1. Validate inputs with Zod (early return on bad input; no DB IO wasted).
 * 2. Verify session.
 * 3. Delegate to typed query functions in lib/queries/funnel.ts which enforce
 *    ownership at the row level.
 * 4. Return typed result objects — never throw — so callers can pattern-match.
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  addFunnelStep,
  deleteFunnelStep,
  addEventAssertion,
  deleteEventAssertion,
  AuthorizationError,
} from "@/lib/queries/funnel";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type ErrorResult = { error: string };
type SuccessResult = { success: true };

// ---------------------------------------------------------------------------
// addFunnelStep
// ---------------------------------------------------------------------------

const addFunnelStepSchema = z.object({
  monitorId: z.string().min(1, "Monitor ID is required"),
  actionType: z.enum(["navigate", "click", "fill", "wait", "submit"]),
  payload: z.record(z.string(), z.unknown()),
  stepOrder: z.number().int().min(0).optional(),
});

export type AddFunnelStepActionResult =
  | ErrorResult
  | { step: { id: string; monitorId: string; stepOrder: number; actionType: string } };

export async function addFunnelStepAction(
  input: z.input<typeof addFunnelStepSchema>,
): Promise<AddFunnelStepActionResult> {
  const parsed = addFunnelStepSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { error: "You must be signed in" };
  }

  try {
    const step = await addFunnelStep(db, parsed.data);
    revalidatePath(`/monitors/${parsed.data.monitorId}`);
    return {
      step: {
        id: step.id,
        monitorId: step.monitorId,
        stepOrder: step.stepOrder,
        actionType: step.actionType,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to add funnel step" };
  }
}

// ---------------------------------------------------------------------------
// deleteFunnelStep
// ---------------------------------------------------------------------------

const deleteFunnelStepSchema = z.object({
  stepId: z.string().min(1, "Step ID is required"),
  monitorId: z.string().min(1, "Monitor ID is required"),
});

export async function deleteFunnelStepAction(
  input: z.input<typeof deleteFunnelStepSchema>,
): Promise<SuccessResult | ErrorResult> {
  const parsed = deleteFunnelStepSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { error: "You must be signed in" };
  }

  try {
    await deleteFunnelStep(db, parsed.data.stepId, session.user.id);
    revalidatePath(`/monitors/${parsed.data.monitorId}`);
    return { success: true };
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { error: err.message };
    }
    return { error: err instanceof Error ? err.message : "Failed to delete funnel step" };
  }
}

// ---------------------------------------------------------------------------
// addEventAssertion
// ---------------------------------------------------------------------------

const addEventAssertionSchema = z.object({
  funnelStepId: z.string().min(1, "Funnel step ID is required"),
  monitorId: z.string().min(1, "Monitor ID is required"),
  platform: z.enum(["ga4", "meta_browser", "meta_capi", "google_ads", "stripe"]),
  eventName: z.string().min(1, "Event name is required"),
  expectedCurrency: z.string().optional(),
  expectedProps: z.record(z.string(), z.unknown()).optional(),
});

export type AddEventAssertionActionResult =
  | ErrorResult
  | { assertion: { id: string; funnelStepId: string; platform: string; eventName: string } };

export async function addEventAssertionAction(
  input: z.input<typeof addEventAssertionSchema>,
): Promise<AddEventAssertionActionResult> {
  const parsed = addEventAssertionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { error: "You must be signed in" };
  }

  try {
    const { monitorId, ...assertionInput } = parsed.data;
    const assertion = await addEventAssertion(db, session.user.id, assertionInput);
    revalidatePath(`/monitors/${monitorId}`);
    return {
      assertion: {
        id: assertion.id,
        funnelStepId: assertion.funnelStepId,
        platform: assertion.platform,
        eventName: assertion.eventName,
      },
    };
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { error: err.message };
    }
    return { error: err instanceof Error ? err.message : "Failed to add event assertion" };
  }
}

// ---------------------------------------------------------------------------
// deleteEventAssertion
// ---------------------------------------------------------------------------

const deleteEventAssertionSchema = z.object({
  assertionId: z.string().min(1, "Assertion ID is required"),
  monitorId: z.string().min(1, "Monitor ID is required"),
});

export async function deleteEventAssertionAction(
  input: z.input<typeof deleteEventAssertionSchema>,
): Promise<SuccessResult | ErrorResult> {
  const parsed = deleteEventAssertionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { error: "You must be signed in" };
  }

  try {
    await deleteEventAssertion(db, parsed.data.assertionId, session.user.id);
    revalidatePath(`/monitors/${parsed.data.monitorId}`);
    return { success: true };
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { error: err.message };
    }
    return {
      error: err instanceof Error ? err.message : "Failed to delete event assertion",
    };
  }
}
