import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuleGroups,
  deleteRules,
  duplicateRule,
  effectiveRule,
  moveRuleToTarget,
  moveRuleWithinGroup,
  moveTopLevel,
  moveTopLevelByDirection,
  projectRuleList
} from "../src/groups.js";

const rules = [
  { id: "a1", enabled: false, key: " X-A ", value: "one" },
  { id: "b", enabled: true, key: "X-B", value: "bee" },
  { id: "a2", enabled: true, key: "x-a", value: "two" },
  { id: "blank", enabled: false, key: "", value: "" }
];

test("visually groups matching keys at their first occurrence without mutating storage order", () => {
  const groups = buildRuleGroups(rules);
  assert.deepEqual(groups.map((group) => group.rules.map((rule) => rule.id)), [["a1", "a2"], ["b"], ["blank"]]);
  assert.deepEqual(rules.map((rule) => rule.id), ["a1", "b", "a2", "blank"]);
  assert.equal(effectiveRule(groups[0]).id, "a2");
  assert.equal(effectiveRule({ ...groups[0], rules: groups[0].rules.map((rule) => ({ ...rule, enabled: false })) }).id, "a1");
});

test("projects collapsed groups at their first occurrence and expanded members in storage order", () => {
  const collapsed = projectRuleList(rules);
  assert.deepEqual(collapsed.map((item) => [item.type, item.rule?.id || item.group.key]), [
    ["collapsed-group", "a2"],
    ["rule", "b"],
    ["rule", "blank"]
  ]);

  const expanded = projectRuleList(rules, new Set(["x-a"]));
  assert.deepEqual(expanded.map((item) => [item.type, item.rule?.id || item.group.key]), [
    ["group-header", "x-a"],
    ["group-member", "a1"],
    ["rule", "b"],
    ["group-member", "a2"],
    ["rule", "blank"]
  ]);
  assert.deepEqual(rules.map((rule) => rule.id), ["a1", "b", "a2", "blank"]);
});

test("duplicates next to the source and makes the copy the only active match", () => {
  const next = duplicateRule(rules, "a1", "copy");
  assert.deepEqual(next.map((rule) => rule.id), ["a1", "copy", "b", "a2", "blank"]);
  assert.deepEqual(next.filter((rule) => rule.key.trim().toLowerCase() === "x-a").map((rule) => rule.enabled), [false, true, false]);
});

test("deletes a complete group by id", () => {
  assert.deepEqual(deleteRules(rules, ["a1", "a2"]).map((rule) => rule.id), ["b", "blank"]);
});

test("moves members only inside their group", () => {
  assert.deepEqual(moveRuleWithinGroup(rules, "a2", -1).map((rule) => rule.id), ["a2", "b", "a1", "blank"]);
  assert.deepEqual(moveRuleToTarget(rules, "a1", "a2", "after").map((rule) => rule.id), ["b", "a2", "a1", "blank"]);
  assert.equal(moveRuleToTarget(rules, "a1", "b", "after"), rules);
});

test("moves a whole visual group or singleton as a top-level unit", () => {
  assert.deepEqual(moveTopLevel(rules, ["a1", "a2"], ["b"], "after").map((rule) => rule.id), ["b", "a1", "a2", "blank"]);
  assert.deepEqual(moveTopLevelByDirection(rules, ["b"], -1).map((rule) => rule.id), ["b", "a1", "a2", "blank"]);
});
