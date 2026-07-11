import assert from "node:assert/strict";
import test from "node:test";
import { analyzeHeaderRules, buildDynamicRules, countApplicableRules, isValidHeaderName } from "../src/rules.js";

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
