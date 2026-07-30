import { normalizeState, STORAGE_KEY } from "./state.js";

export const LANGUAGE_KEY = "header-patch:locale:v1";

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

export async function loadLanguage() {
  if (hasExtensionStorage()) {
    const stored = await chrome.storage.local.get(LANGUAGE_KEY);
    return stored[LANGUAGE_KEY] === "zh-CN" || stored[LANGUAGE_KEY] === "en"
      ? stored[LANGUAGE_KEY]
      : null;
  }
  const value = localStorage.getItem(LANGUAGE_KEY);
  return value === "zh-CN" || value === "en" ? value : null;
}

export async function persistLanguage(language) {
  if (hasExtensionStorage()) {
    await chrome.storage.local.set({ [LANGUAGE_KEY]: language });
    return;
  }
  localStorage.setItem(LANGUAGE_KEY, language);
}
