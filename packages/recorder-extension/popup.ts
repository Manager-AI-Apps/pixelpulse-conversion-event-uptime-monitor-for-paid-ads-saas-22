/**
 * PixelPulse Funnel Recorder — Popup Script (Manifest V3)
 *
 * Renders the list of recorded steps and provides controls:
 *   Start / Stop recording  →  PP_START / PP_STOP messages to background
 *   Export JSON             →  downloads a funnel config JSON file
 *   Clear                   →  PP_CLEAR message to background
 *
 * Pure schema logic is in ./schema so it can be tested independently.
 */

import { buildExportData, isFunnelStep } from "./schema";
import type { FunnelStep, ActionType } from "./schema";

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const startBtn   = document.getElementById("start-btn")   as HTMLButtonElement;
const exportBtn  = document.getElementById("export-btn")  as HTMLButtonElement;
const clearBtn   = document.getElementById("clear-btn")   as HTMLButtonElement;
const stepsList  = document.getElementById("steps-list")  as HTMLDivElement;
const statusPill = document.getElementById("status-pill") as HTMLSpanElement;
const stepCount  = document.getElementById("step-count")  as HTMLSpanElement;

// ─── state ────────────────────────────────────────────────────────────────────

let recording = false;
let steps: FunnelStep[] = [];

// ─── render ───────────────────────────────────────────────────────────────────

function badgeClass(actionType: ActionType): string {
  return `step-badge badge-${actionType}`;
}

function renderSteps(): void {
  stepCount.textContent = String(steps.length);
  exportBtn.disabled = steps.length === 0;

  if (steps.length === 0) {
    stepsList.innerHTML = `
      <div class="empty-state">
        <div class="icon">&#9654;&#65039;</div>
        <p>Hit <strong>Start</strong> then use your site normally.<br/>
        Every click, fill, and page load is captured here.</p>
      </div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  steps.forEach((step, idx) => {
    const item = document.createElement("div");
    item.className = "step-item";
    item.innerHTML = `
      <span class="step-index">${idx + 1}</span>
      <span class="${badgeClass(step.actionType)}">${step.actionType}</span>
      <div class="step-info">
        <span class="step-selector">${escapeHtml(step.selector || step.url)}</span>
        ${step.value ? `<span class="step-url">${escapeHtml(step.value)}</span>` : ""}
        <span class="step-url">${escapeHtml(step.url)}</span>
      </div>`;
    fragment.appendChild(item);
  });
  stepsList.innerHTML = "";
  stepsList.appendChild(fragment);
}

function renderRecordingState(): void {
  if (recording) {
    statusPill.textContent = "● REC";
    statusPill.classList.add("recording");
    startBtn.textContent = "■ Stop";
    startBtn.classList.add("active");
  } else {
    statusPill.textContent = "Idle";
    statusPill.classList.remove("recording");
    startBtn.textContent = "▶ Start";
    startBtn.classList.remove("active");
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── background messaging ────────────────────────────────────────────────────

function sendToBackground(type: "PP_START" | "PP_STOP" | "PP_CLEAR" | "PP_GET"): Promise<{
  steps?: FunnelStep[];
  recording?: boolean;
}> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type }, (response: { steps?: FunnelStep[]; recording?: boolean } | undefined) => {
      resolve(response ?? {});
    });
  });
}

async function refreshState(): Promise<void> {
  const state = await sendToBackground("PP_GET");
  recording = Boolean(state.recording);
  steps = Array.isArray(state.steps) ? state.steps.filter(isFunnelStep) : [];
  renderRecordingState();
  renderSteps();
}

// ─── event handlers ──────────────────────────────────────────────────────────

startBtn.addEventListener("click", async () => {
  if (recording) {
    await sendToBackground("PP_STOP");
  } else {
    await sendToBackground("PP_START");
  }
  await refreshState();
});

exportBtn.addEventListener("click", () => {
  if (steps.length === 0) return;

  const payload = buildExportData(steps);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `pixelpulse-funnel-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

clearBtn.addEventListener("click", async () => {
  if (!confirm("Clear all recorded steps?")) return;
  await sendToBackground("PP_CLEAR");
  await refreshState();
});

// ─── init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  refreshState().catch(console.error);
});
