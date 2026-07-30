import { enforceExclusiveEnabledRules } from "./rules.js";

export const STORAGE_KEY = "header-patch:state:v1";

export const DEFAULT_STATE = {
  active: true,
  rules: []
};

export function cloneDefaultState() {
  return structuredClone(DEFAULT_STATE);
}

export function makeRuleId() {
  return `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeRule(rule, fallbackId) {
  return {
    id: typeof rule?.id === "string" ? rule.id : fallbackId,
    enabled: rule?.enabled === true,
    key: typeof rule?.key === "string" ? rule.key : "",
    value: typeof rule?.value === "string" ? rule.value : ""
  };
}

export function normalizeState(value) {
  if (!value || typeof value !== "object") return cloneDefaultState();

  const savedRules = Array.isArray(value.rules)
    ? value.rules
    : Array.isArray(value.rules?.request) ? value.rules.request : null;

  return {
    active: value.active !== false,
    rules: savedRules
      ? enforceExclusiveEnabledRules(savedRules
        .map((rule, index) => normalizeRule(rule, `req-${index + 1}`))
        .filter((rule) => {
          const legacyDefault = /^req-[1-5]$/.test(rule.id);
          return !(legacyDefault && !rule.key.trim() && !rule.value.trim());
        }))
      : cloneDefaultState().rules
  };
}
