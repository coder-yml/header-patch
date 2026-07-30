import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STATE, normalizeState, STORAGE_KEY } from "../src/state.js";

test("normalizes a saved request-header state", () => {
  const normalized = normalizeState({
    active: false,
    rules: [{ id: "custom", enabled: false, key: "X-Test", value: "value" }]
  });

  assert.deepEqual(normalized, {
    active: false,
    rules: [{ id: "custom", enabled: false, key: "X-Test", value: "value" }]
  });
});

test("uses clean v1 defaults for invalid state", () => {
  assert.equal(STORAGE_KEY, "header-patch:state:v1");
  assert.deepEqual(normalizeState(null), DEFAULT_STATE);
  assert.deepEqual(normalizeState({ active: true }), DEFAULT_STATE);
  assert.notEqual(normalizeState(null), DEFAULT_STATE);
});

test("removes only untouched legacy blank defaults", () => {
  const normalized = normalizeState({
    active: true,
    rules: [
      { id: "req-1", enabled: true, key: "", value: "" },
      { id: "req-2", enabled: true, key: "X-Keep", value: "" },
      { id: "custom", enabled: false, key: "", value: "" }
    ]
  });

  assert.deepEqual(normalized.rules.map((rule) => rule.id), ["req-2", "custom"]);
});

test("accepts the legacy request rules container", () => {
  const normalized = normalizeState({
    active: true,
    rules: { request: [{ id: "legacy", enabled: true, key: "X-Legacy", value: "yes" }] }
  });
  assert.deepEqual(normalized.rules, [{ id: "legacy", enabled: true, key: "X-Legacy", value: "yes" }]);
});

test("normalization keeps only the last enabled rule for duplicate keys", () => {
  const normalized = normalizeState({
    active: true,
    rules: [
      { id: "first", enabled: true, key: " X-Test ", value: "first" },
      { id: "last", enabled: true, key: "x-test", value: "last" }
    ]
  });

  assert.equal(normalized.rules[0].enabled, false);
  assert.equal(normalized.rules[1].enabled, true);
});
