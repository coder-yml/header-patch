import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
