import { normalizeState, STORAGE_KEY } from "./state.js";

const hasExtensionStorage = () => Boolean(globalThis.chrome?.storage?.local);

export async function loadState() {
  if (hasExtensionStorage()) {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeState(stored[STORAGE_KEY]);
  }

  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return normalizeState(null);
  }
}

export async function persistState(state) {
  if (hasExtensionStorage()) {
    const response = await chrome.runtime.sendMessage({ type: "SAVE_STATE", state });
    if (!response?.ok) throw new Error(response?.error || "SAVE_STATE failed");
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
