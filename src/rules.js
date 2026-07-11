const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "media",
  "websocket",
  "other"
];

export function isValidHeaderName(value) {
  return HEADER_NAME_PATTERN.test(value.trim());
}

export function analyzeHeaderRules(rules) {
  const candidates = [];
  const issues = new Map();

  rules.forEach((rule, index) => {
    const header = rule.key.trim();
    if (!rule.enabled) return;
    if (!header) {
      if (rule.value.trim()) issues.set(rule.id, { code: "missingHeaderName" });
      return;
    }
    if (!isValidHeaderName(header)) {
      issues.set(rule.id, { code: "invalidHeaderName" });
      return;
    }

    candidates.push({ index, rule, header, normalizedKey: header.toLowerCase() });
  });

  const lastIndexByHeader = new Map(
    candidates.map((candidate) => [candidate.normalizedKey, candidate.index])
  );
  const operations = [];

  for (const candidate of candidates) {
    if (lastIndexByHeader.get(candidate.normalizedKey) !== candidate.index) {
      issues.set(candidate.rule.id, { code: "duplicateHeader", substitutions: [candidate.header] });
      continue;
    }

    operations.push({
      header: candidate.header,
      operation: "set",
      value: candidate.rule.value
    });
  }

  return { count: operations.length, issues, operations };
}

export function countApplicableRules(state) {
  return state.active ? analyzeHeaderRules(state.rules).count : 0;
}

export function buildDynamicRules(state) {
  if (!state.active) return [];

  const requestHeaders = analyzeHeaderRules(state.rules).operations;
  const condition = { urlFilter: "|http", resourceTypes: RESOURCE_TYPES };

  return requestHeaders.length > 0
    ? [{
      id: 1001,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders },
      condition
    }]
    : [];
}
