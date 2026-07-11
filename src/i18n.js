const FALLBACK_MESSAGES = {
  en: {
    extensionName: "Header Patch",
    extensionDescription: "Set or overwrite browser request headers in real time.",
    tagline: "Request headers for Chrome · Edge",
    loading: "Loading rules…",
    loadingLabel: "Loading Header Patch",
    enableRule: "Enable this rule",
    deleteRule: "Delete this rule",
    deleteRuleTitle: "Delete rule",
    headerName: "Header name",
    headerValue: "Header value",
    enableAll: "Enable all header rules",
    masterSwitch: "Master switch",
    appliedCount: "$1 active",
    appliedCountTitle: "$1 request header rules active",
    emptyState: "No rules yet. Use the button below to add one.",
    addRule: "Add a header rule",
    addRuleTitle: "Add rule",
    readFailed: "Could not load saved rules. Defaults are in use.",
    saveFailed: "Could not save rules",
    ruleDeleted: "Rule deleted",
    ruleAdded: "Rule added",
    allEnabled: "All header rules enabled",
    allPaused: "All header rules paused",
    missingHeaderName: "Enter a header name",
    invalidHeaderName: "The header name contains invalid characters",
    duplicateHeader: "Duplicate header: the later $1 rule takes precedence",
    badgeActive: "Header Patch · $1 request rules active",
    badgePaused: "Header Patch · Paused",
    backgroundSaveFailed: "Background save failed"
  },
  zh: {
    extensionName: "Header Patch",
    extensionDescription: "实时写入或覆盖浏览器请求 Header。",
    tagline: "适用于 Chrome · Edge 的请求头",
    loading: "正在读取规则…",
    loadingLabel: "正在加载 Header Patch",
    enableRule: "启用此规则",
    deleteRule: "删除此规则",
    deleteRuleTitle: "删除规则",
    headerName: "Header 名称",
    headerValue: "Header 值",
    enableAll: "启用全部 Header 规则",
    masterSwitch: "总开关",
    appliedCount: "$1 条生效",
    appliedCountTitle: "$1 条请求 Header 规则生效",
    emptyState: "暂无规则，点击下方“＋”添加一条。",
    addRule: "添加 Header 规则",
    addRuleTitle: "添加规则",
    readFailed: "读取配置失败，已使用默认规则",
    saveFailed: "规则保存失败",
    ruleDeleted: "已删除规则",
    ruleAdded: "已新增规则",
    allEnabled: "已启用全部 Header 规则",
    allPaused: "已暂停全部 Header 规则",
    missingHeaderName: "请填写 Header 名称",
    invalidHeaderName: "Header 名称包含非法字符",
    duplicateHeader: "重复 Header：后面的 $1 规则将覆盖此项",
    badgeActive: "Header Patch · $1 条请求规则生效",
    badgePaused: "Header Patch · 已暂停",
    backgroundSaveFailed: "后台保存失败"
  }
};

const normalizeSubstitutions = (substitutions) => {
  if (substitutions === undefined) return [];
  return (Array.isArray(substitutions) ? substitutions : [substitutions]).map(String);
};

const interpolate = (message, substitutions) => substitutions.reduce(
  (result, value, index) => result.replaceAll(`$${index + 1}`, value),
  message
);

function fallbackLocale() {
  const language = globalThis.navigator?.language || "en";
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function t(key, substitutions) {
  const values = normalizeSubstitutions(substitutions);
  const extensionMessage = globalThis.chrome?.i18n?.getMessage?.(key, values);
  if (extensionMessage) return extensionMessage;
  const message = FALLBACK_MESSAGES[fallbackLocale()][key] || FALLBACK_MESSAGES.en[key] || key;
  return interpolate(message, values);
}
