import { normalizeHeaderKey, replaceHeaderRule } from "./rules.js";

export function buildRuleGroups(rules) {
  const named = new Map();

  for (const rule of rules) {
    const key = normalizeHeaderKey(rule.key);
    if (!key) continue;
    if (!named.has(key)) named.set(key, { key, rules: [] });
    named.get(key).rules.push(rule);
  }

  const emitted = new Set();
  return rules.reduce((groups, rule) => {
    const key = normalizeHeaderKey(rule.key);
    if (!key) {
      groups.push({ key: "", rules: [rule] });
    } else if (!emitted.has(key)) {
      groups.push(named.get(key));
      emitted.add(key);
    }
    return groups;
  }, []);
}

export function effectiveRule(group) {
  return group.rules.find((rule) => rule.enabled) || group.rules[0];
}

export function projectRuleList(rules, expandedKeys = new Set(), groups = buildRuleGroups(rules)) {
  const groupByRuleId = new Map();

  for (const group of groups) {
    if (group.rules.length < 2) continue;
    for (const rule of group.rules) groupByRuleId.set(rule.id, group);
  }

  return rules.flatMap((rule) => {
    const group = groupByRuleId.get(rule.id);
    if (!group) return [{ type: "rule", rule }];

    const first = group.rules[0].id === rule.id;
    if (!expandedKeys.has(group.key)) {
      return first ? [{ type: "collapsed-group", group, rule: effectiveRule(group) }] : [];
    }

    return first
      ? [{ type: "group-header", group }, { type: "group-member", group, rule }]
      : [{ type: "group-member", group, rule }];
  });
}

export function duplicateRule(rules, sourceId, nextId) {
  const index = rules.findIndex((rule) => rule.id === sourceId);
  if (index < 0) return rules;
  const source = { ...rules[index], enabled: false };
  const duplicate = { ...source, id: nextId, enabled: true };
  const next = rules.slice();
  next.splice(index, 1, source, duplicate);
  return replaceHeaderRule(next, duplicate);
}

export function deleteRules(rules, ids) {
  const removed = new Set(ids);
  return rules.filter((rule) => !removed.has(rule.id));
}

export function moveRuleWithinGroup(rules, sourceId, direction) {
  const source = rules.find((rule) => rule.id === sourceId);
  if (!source) return rules;
  const key = normalizeHeaderKey(source.key);
  if (!key) return rules;
  const memberIndexes = rules
    .map((rule, index) => normalizeHeaderKey(rule.key) === key ? index : -1)
    .filter((index) => index >= 0);
  const sourceIndex = rules.findIndex((rule) => rule.id === sourceId);
  const memberPosition = memberIndexes.indexOf(sourceIndex);
  const targetIndex = memberIndexes[memberPosition + direction];
  if (targetIndex === undefined) return rules;
  const next = rules.slice();
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
  return next;
}

export function moveRuleToTarget(rules, sourceId, targetId, placement) {
  if (sourceId === targetId) return rules;
  const source = rules.find((rule) => rule.id === sourceId);
  const target = rules.find((rule) => rule.id === targetId);
  if (!source || !target || normalizeHeaderKey(source.key) !== normalizeHeaderKey(target.key)) return rules;
  const sourceIndex = rules.findIndex((rule) => rule.id === sourceId);
  const targetIndex = rules.findIndex((rule) => rule.id === targetId);
  const next = rules.slice();
  const [moved] = next.splice(sourceIndex, 1);
  let insertionIndex = targetIndex + (placement === "after" ? 1 : 0);
  if (sourceIndex < insertionIndex) insertionIndex -= 1;
  next.splice(insertionIndex, 0, moved);
  return next.every((rule, index) => rule.id === rules[index]?.id) ? rules : next;
}

export function moveTopLevel(rules, sourceIds, targetIds, placement) {
  const sourceSet = new Set(sourceIds);
  const targetSet = new Set(targetIds);
  if (!sourceSet.size || [...sourceSet].some((id) => targetSet.has(id))) return rules;
  const moved = rules.filter((rule) => sourceSet.has(rule.id));
  const remaining = rules.filter((rule) => !sourceSet.has(rule.id));
  if (!moved.length) return rules;

  let targetIndex = -1;
  if (placement === "before") {
    targetIndex = remaining.findIndex((rule) => targetSet.has(rule.id));
  } else {
    remaining.forEach((rule, index) => {
      if (targetSet.has(rule.id)) targetIndex = index + 1;
    });
  }
  if (targetIndex < 0) return rules;
  const next = [...remaining.slice(0, targetIndex), ...moved, ...remaining.slice(targetIndex)];
  return next.every((rule, index) => rule.id === rules[index]?.id) ? rules : next;
}

export function moveTopLevelByDirection(rules, sourceIds, direction) {
  const groups = buildRuleGroups(rules);
  const sourceSet = new Set(sourceIds);
  const sourceIndex = groups.findIndex((group) => group.rules.some((rule) => sourceSet.has(rule.id)));
  const target = groups[sourceIndex + direction];
  if (sourceIndex < 0 || !target) return rules;
  return moveTopLevel(
    rules,
    sourceIds,
    target.rules.map((rule) => rule.id),
    direction < 0 ? "before" : "after"
  );
}
