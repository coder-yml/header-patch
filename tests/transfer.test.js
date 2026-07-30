import assert from "node:assert/strict";
import test from "node:test";
import { exportableRules, parseImportedHeaders, parseInlineHeader, serializeRules } from "../src/transfer.js";

test("parses all supported inline Header formats", () => {
  assert.deepEqual(parseInlineHeader("X-One value with spaces"), { key: "X-One", value: "value with spaces" });
  assert.deepEqual(parseInlineHeader("X-Two = two"), { key: "X-Two", value: "two" });
  assert.deepEqual(parseInlineHeader("X-Three: three:more"), { key: "X-Three", value: "three:more" });
});

test("parses mixed inline and alternating-line imports with source line errors", () => {
  assert.deepEqual(parseImportedHeaders("\nX-One=one\n\nX-Two\ntwo\nX-Three three\n"), {
    rules: [
      { key: "X-One", value: "one" },
      { key: "X-Two", value: "two" },
      { key: "X-Three", value: "three" }
    ],
    error: null
  });
  assert.deepEqual(parseImportedHeaders(" \n"), { rules: [], error: { code: "importEmpty" } });
  assert.deepEqual(parseImportedHeaders("\nX-Missing\n"), { rules: [], error: { code: "missingValue", values: { line: 2 } } });
});

test("exports selected non-empty rules in storage order", () => {
  const rules = [
    { id: "1", key: " X-One ", value: "one", enabled: true },
    { id: "2", key: "", value: "ignored", enabled: false },
    { id: "3", key: "X-One", value: "two", enabled: false }
  ];
  assert.deepEqual(exportableRules(rules).map((rule) => rule.id), ["1", "3"]);
  assert.equal(serializeRules(rules, new Set(["1", "3"])), "X-One=one\nX-One=two");
});
