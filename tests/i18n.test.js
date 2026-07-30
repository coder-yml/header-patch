import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MESSAGES, t } from "../src/i18n.js";

const readMessages = async (locale) => JSON.parse(await readFile(
  new URL(`../public/_locales/${locale}/messages.json`, import.meta.url),
  "utf8"
));

test("English and Chinese locale catalogs have matching keys", async () => {
  const english = await readMessages("en");
  const chinese = await readMessages("zh_CN");

  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const entry of Object.values(english)) assert.ok(entry.message);
  for (const entry of Object.values(chinese)) assert.ok(entry.message);
});

test("runtime dictionaries are complete and support explicit locale switching", () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES["zh-CN"]).sort());
  assert.equal(t("selectionSummary", { selected: 2, total: 3 }, "en"), "Selected 2 / 3");
  assert.equal(t("selectionSummary", { selected: 2, total: 3 }, "zh-CN"), "已选 2 / 3 项");
  assert.equal(t("appliedCount", 4, "en"), "4 active");
});
