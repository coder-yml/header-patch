export const STORAGE_KEY = "header-patch:state:v1";

const emptyRule = (id) => ({ id, enabled: true, key: "", value: "" });

export const DEFAULT_STATE = {
  active: true,
  rules: Array.from({ length: 5 }, (_, index) => emptyRule(`req-${index + 1}`))
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
    enabled: rule?.enabled !== false,
    key: typeof rule?.key === "string" ? rule.key : "",
    value: typeof rule?.value === "string" ? rule.value : ""
  };
}

export function normalizeState(value) {
  if (!value || typeof value !== "object") return cloneDefaultState();

  return {
    active: value.active !== false,
    rules: Array.isArray(value.rules)
      ? value.rules.map((rule, index) => normalizeRule(rule, `req-${index + 1}`))
      : cloneDefaultState().rules
  };
}
