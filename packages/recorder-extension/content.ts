/**
 * PixelPulse Funnel Recorder — Content Script (Manifest V3)
 *
 * Runs in the context of every web page.  Listens for user interactions
 * (clicks, input changes, and navigation) and forwards them to the
 * background service worker via chrome.runtime.sendMessage.
 *
 * Each message has the shape:
 *   { type: "PP_STEP", step: FunnelStep }
 *
 * Navigation events are synthesised from the beforeunload event so that the
 * destination URL is captured by the background script once the new page loads.
 */

import type { FunnelStep, ActionType } from "./schema";

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the shortest unique CSS selector for an element.
 * Falls back to the element's tag name if nothing useful is found.
 */
function buildSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  // Collect class-based unique selector
  const classes = Array.from(el.classList)
    .filter((c) => /^[a-z_-]/i.test(c))
    .slice(0, 3)
    .map((c) => `.${CSS.escape(c)}`)
    .join("");

  const tag = el.tagName.toLowerCase();
  const candidate = classes ? `${tag}${classes}` : tag;

  // Only return if it uniquely identifies the element
  try {
    if (document.querySelectorAll(candidate).length === 1) return candidate;
  } catch {
    // ignore selector errors
  }

  // Fallback: nth-child path from document root (up to 4 levels)
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; depth < 4 && node && node !== document.documentElement; depth++) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const index = Array.from(parent.children).indexOf(node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    node = parent;
  }
  return parts.join(" > ") || tag;
}

function sendStep(step: FunnelStep): void {
  try {
    chrome.runtime.sendMessage({ type: "PP_STEP", step });
  } catch {
    // Extension context may be invalidated; silently ignore
  }
}

// ─── recording flag ──────────────────────────────────────────────────────────

// Only capture events while the background script has recording active.
let isRecording = false;

chrome.storage.local.get(["ppRecording"], (result) => {
  isRecording = Boolean(result.ppRecording);
});

chrome.storage.onChanged.addListener((changes) => {
  if ("ppRecording" in changes) {
    isRecording = Boolean(changes.ppRecording.newValue);
  }
});

// ─── click capture ──────────────────────────────────────────────────────────

document.addEventListener(
  "click",
  (e: MouseEvent) => {
    if (!isRecording) return;
    const target = e.target as Element | null;
    if (!target) return;
    sendStep({
      actionType: "click" satisfies ActionType,
      selector: buildSelector(target),
      value: "",
      url: location.href,
    });
  },
  { capture: true, passive: true },
);

// ─── fill / input capture ────────────────────────────────────────────────────

document.addEventListener(
  "change",
  (e: Event) => {
    if (!isRecording) return;
    const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (!target) return;
    // Avoid leaking passwords / sensitive data
    const inputType = (target as HTMLInputElement).type ?? "";
    const value = ["password", "hidden"].includes(inputType) ? "" : target.value;
    sendStep({
      actionType: "fill" satisfies ActionType,
      selector: buildSelector(target),
      value,
      url: location.href,
    });
  },
  { capture: true, passive: true },
);

// ─── navigation capture ──────────────────────────────────────────────────────

// Capture same-page form submits
document.addEventListener(
  "submit",
  (e: SubmitEvent) => {
    if (!isRecording) return;
    const form = e.target as HTMLFormElement | null;
    if (!form) return;
    const action = form.action || location.href;
    sendStep({
      actionType: "navigate" satisfies ActionType,
      selector: buildSelector(form),
      value: "",
      url: action,
    });
  },
  { capture: true, passive: true },
);

// Capture hard-navigate (tab unloads)
window.addEventListener("beforeunload", () => {
  if (!isRecording) return;
  sendStep({
    actionType: "navigate" satisfies ActionType,
    selector: "",
    value: "",
    url: location.href,
  });
});
