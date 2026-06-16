/**
 * PixelPulse Funnel Recorder — Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  1. Persist recorded FunnelStep[] to chrome.storage.local under the key
 *     "ppSteps".
 *  2. Track whether recording is active ("ppRecording" boolean) so the content
 *     script knows whether to forward events.
 *  3. Handle messages from the content script ({ type: "PP_STEP", step }) and
 *     append them to the stored array.
 *  4. Handle messages from the popup:
 *       { type: "PP_START" }  → start recording
 *       { type: "PP_STOP" }   → stop recording
 *       { type: "PP_CLEAR" }  → clear all recorded steps
 *       { type: "PP_GET" }    → return { steps, recording } state
 */

import type { FunnelStep } from "./schema";
import { isFunnelStep } from "./schema";

// ─── message types ───────────────────────────────────────────────────────────

interface StepMessage {
  type: "PP_STEP";
  step: FunnelStep;
}

interface ControlMessage {
  type: "PP_START" | "PP_STOP" | "PP_CLEAR" | "PP_GET";
}

type ExtensionMessage = StepMessage | ControlMessage;

interface StateResponse {
  steps: FunnelStep[];
  recording: boolean;
}

// ─── storage helpers ─────────────────────────────────────────────────────────

async function getState(): Promise<StateResponse> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["ppSteps", "ppRecording"], (result) => {
      resolve({
        steps: Array.isArray(result.ppSteps) ? (result.ppSteps as FunnelStep[]) : [],
        recording: Boolean(result.ppRecording),
      });
    });
  });
}

async function setState(patch: Partial<{ ppSteps: FunnelStep[]; ppRecording: boolean }>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(patch, resolve);
  });
}

// ─── message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: StateResponse | { ok: true }) => void,
  ) => {
    // Must return true to use async sendResponse
    (async () => {
      const state = await getState();

      switch (message.type) {
        case "PP_STEP": {
          if (!state.recording) break;
          const step = message.step;
          if (!isFunnelStep(step)) break;
          // De-duplicate consecutive identical actions on the same selector
          const last = state.steps.at(-1);
          const isDuplicate =
            last &&
            last.actionType === step.actionType &&
            last.selector === step.selector &&
            last.url === step.url &&
            last.value === step.value;
          if (!isDuplicate) {
            await setState({ ppSteps: [...state.steps, step] });
          }
          sendResponse({ ok: true });
          break;
        }

        case "PP_START": {
          await setState({ ppRecording: true });
          sendResponse({ ok: true });
          break;
        }

        case "PP_STOP": {
          await setState({ ppRecording: false });
          sendResponse({ ok: true });
          break;
        }

        case "PP_CLEAR": {
          await setState({ ppSteps: [], ppRecording: false });
          sendResponse({ ok: true });
          break;
        }

        case "PP_GET": {
          const fresh = await getState();
          sendResponse(fresh);
          break;
        }

        default:
          break;
      }
    })().catch(console.error);

    return true; // keep the message channel open for async response
  },
);

// ─── tab navigation capture ──────────────────────────────────────────────────

// When a tab commits a navigation, record a "navigate" step automatically
// (supplements the content script's beforeunload capture).
chrome.webNavigation?.onCommitted?.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  const state = await getState();
  if (!state.recording) return;
  // Check if the last step already captured this URL to avoid duplicates
  const last = state.steps.at(-1);
  if (last?.url === details.url && last.actionType === "navigate") return;

  const step: FunnelStep = {
    actionType: "navigate",
    selector: "",
    value: "",
    url: details.url,
  };
  await setState({ ppSteps: [...state.steps, step] });
});
