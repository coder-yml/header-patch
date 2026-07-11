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
