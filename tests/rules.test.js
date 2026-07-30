import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeHeaderRules,
  buildDynamicRules,
  countApplicableRules,
  enforceExclusiveEnabledRules,
  isValidHeaderName,
  normalizeHeaderKey,
  replaceHeaderRule
} from "../src/rules.js";

const state = {
  active: true,
  rules: [
    { id: "1", enabled: true, key: "X-Debug", value: "one" },
    { id: "2", enabled: true, key: "x-debug", value: "two" },
    { id: "3", enabled: false, key: "X-Off", value: "ignored" },
    { id: "4", enabled: true, key: "", value: "ignored" }
  ]
};

test("validates standard header names", () => {
  assert.equal(isValidHeaderName("X-Debug-Mode"), true);
  assert.equal(isValidHeaderName("bad header"), false);
  assert.equal(isValidHeaderName(""), false);
});

test("normalizes header keys case-insensitively", () => {
  assert.equal(normalizeHeaderKey("  X-Debug  "), "x-debug");
});

test("enabling or renaming a rule disables other enabled rules with the same key", () => {
  const rules = [
    { id: "first", enabled: true, key: " X-Test ", value: "first" },
    { id: "second", enabled: false, key: "x-test", value: "second" },
    { id: "blank", enabled: true, key: "", value: "blank" }
  ];

  const afterEnable = replaceHeaderRule(rules, { ...rules[1], enabled: true });
  assert.deepEqual(afterEnable.map(({ id, enabled }) => ({ id, enabled })), [
    { id: "first", enabled: false },
    { id: "second", enabled: true },
    { id: "blank", enabled: true }
  ]);

  const afterDisable = replaceHeaderRule(afterEnable, { ...afterEnable[1], enabled: false });
  assert.deepEqual(afterDisable.map(({ id, enabled }) => ({ id, enabled })), [
    { id: "first", enabled: false },
    { id: "second", enabled: false },
    { id: "blank", enabled: true }
  ]);

  const afterRename = replaceHeaderRule(afterEnable, { ...afterEnable[2], key: "X-TEST" });
  assert.deepEqual(afterRename.map(({ id, enabled }) => ({ id, enabled })), [
    { id: "first", enabled: false },
    { id: "second", enabled: false },
    { id: "blank", enabled: true }
  ]);

  const disabledRename = replaceHeaderRule(rules, { ...rules[1], key: "X-Other" });
  assert.equal(disabledRename[0].enabled, true);
  assert.equal(disabledRename[1].enabled, false);
});

test("reconciles pre-existing enabled duplicates by keeping the last rule enabled", () => {
  const reconciled = enforceExclusiveEnabledRules([
    { id: "first", enabled: true, key: "X-Test", value: "first" },
    { id: "empty-one", enabled: true, key: "", value: "" },
    { id: "middle", enabled: true, key: "x-TEST", value: "middle" },
    { id: "last", enabled: true, key: "x-test", value: "last" },
    { id: "empty-two", enabled: true, key: "  ", value: "" }
  ]);

  assert.deepEqual(reconciled.map(({ id, enabled }) => ({ id, enabled })), [
    { id: "first", enabled: false },
    { id: "empty-one", enabled: true },
    { id: "middle", enabled: false },
    { id: "last", enabled: true },
    { id: "empty-two", enabled: true }
  ]);
});

test("builds request-only rules and lets the later duplicate win", () => {
  const analysis = analyzeHeaderRules(state.rules);
  const rules = buildDynamicRules(state);
  assert.equal(analysis.count, 1);
  assert.deepEqual(analysis.issues.get("1"), { code: "duplicateHeader", substitutions: ["X-Debug"] });
  assert.deepEqual(analysis.issues.get("4"), { code: "missingHeaderName" });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].action.requestHeaders, [
    { header: "x-debug", operation: "set", value: "two" }
  ]);
  assert.equal("responseHeaders" in rules[0].action, false);
  assert.equal(countApplicableRules(state), 1);
});

test("builds and counts multiple request headers", () => {
  const rules = Array.from({ length: 10 }, (_, index) => ({
    id: String(index),
    enabled: true,
    key: `X-Multi-${index}`,
    value: `value-${index}`
  }));
  const multiple = { active: true, rules };
  const dynamicRules = buildDynamicRules(multiple);

  assert.equal(dynamicRules.length, 1);
  assert.equal(dynamicRules[0].action.requestHeaders.length, 10);
  assert.equal(countApplicableRules(multiple), 10);
});

test("removes all dynamic rules when paused", () => {
  const paused = { ...state, active: false };
  assert.deepEqual(buildDynamicRules(paused), []);
  assert.equal(countApplicableRules(paused), 0);
});
