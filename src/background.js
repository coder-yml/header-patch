import { buildDynamicRules, countApplicableRules } from "./rules.js";
import { t } from "./i18n.js";
import { normalizeState, STORAGE_KEY } from "./state.js";

let pendingState = null;
let drainPromise = null;

async function readState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(stored[STORAGE_KEY]);
}

async function updateBadge(state) {
  const count = countApplicableRules(state);
  await chrome.action.setBadgeBackgroundColor({ color: state.active ? "#265cc5" : "#7b8492" });
  await chrome.action.setBadgeText({ text: state.active ? (count ? String(count) : "") : "OFF" });
  await chrome.action.setTitle({
    title: state.active ? t("badgeActive", count) : t("badgePaused")
  });
}

export async function applyState(value) {
  const state = normalizeState(value);
  const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
  const dynamicRules = buildDynamicRules(state);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: currentRules.map((rule) => rule.id),
    addRules: dynamicRules
  });
  await updateBadge(state);
}

async function applyStoredState() {
  await queueSave(await readState());
}

function queueSave(value) {
  pendingState = normalizeState(value);

  if (!drainPromise) {
    drainPromise = (async () => {
      while (pendingState) {
        const latestState = pendingState;
        pendingState = null;
        await chrome.storage.local.set({ [STORAGE_KEY]: latestState });
        await applyState(latestState);
      }
    })().finally(() => {
      drainPromise = null;
    });
  }

  return drainPromise;
}

chrome.runtime.onInstalled.addListener(() => {
  applyStoredState().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  applyStoredState().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SAVE_STATE") return false;

  queueSave(message.state)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
