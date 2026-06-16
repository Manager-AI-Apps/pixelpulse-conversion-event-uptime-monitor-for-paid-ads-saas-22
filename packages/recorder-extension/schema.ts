/**
 * Shared schema types and validators for the PixelPulse funnel recorder.
 *
 * This module has NO dependency on Chrome extension APIs so it can be
 * imported safely in unit tests (Vitest / jsdom) as well as within the
 * extension itself.
 */

export const VALID_ACTION_TYPES = ["click", "fill", "navigate", "wait"] as const;

export type ActionType = (typeof VALID_ACTION_TYPES)[number];

/**
 * A single recorded funnel step that is exported / imported into PixelPulse.
 *
 * Fields:
 *   actionType – one of click | fill | navigate | wait
 *   selector   – CSS selector of the target element (empty string for navigate)
 *   value      – text typed (fill), wait duration in ms (wait), or empty string
 *   url        – full URL of the page at the time the action was recorded
 */
export interface FunnelStep {
  actionType: ActionType;
  selector: string;
  value: string;
  url: string;
}

/**
 * Type guard: returns true when `obj` is a well-formed FunnelStep.
 */
export function isFunnelStep(obj: unknown): obj is FunnelStep {
  if (!obj || typeof obj !== "object") return false;
  const step = obj as Record<string, unknown>;
  return (
    (VALID_ACTION_TYPES as ReadonlyArray<unknown>).includes(step.actionType) &&
    typeof step.selector === "string" &&
    typeof step.value === "string" &&
    typeof step.url === "string"
  );
}

/**
 * Returns a clean copy of the steps array suitable for JSON export.
 * Filters out any malformed entries defensively.
 */
export function buildExportData(steps: FunnelStep[]): FunnelStep[] {
  return steps
    .filter(isFunnelStep)
    .map(({ actionType, selector, value, url }) => ({
      actionType,
      selector,
      value,
      url,
    }));
}
