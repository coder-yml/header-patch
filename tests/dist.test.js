import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readDist = (path) => readFile(new URL(`../dist/${path}`, import.meta.url), "utf8");
const readDistBinary = (path) => readFile(new URL(`../dist/${path}`, import.meta.url));

test("production build contains a loadable localized Manifest V3 extension", async () => {
  const manifest = JSON.parse(await readDist("manifest.json"));
  const popup = await readDist("index.html");
  const background = await readDist("background.js");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.action.default_popup, "index.html");
  assert.equal(manifest.action.default_icon[16], "icons/icon-16.png");
  assert.equal(manifest.icons[128], "icons/icon-128.png");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.background.type, "module");
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("declarativeNetRequestWithHostAccess"));
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.match(popup, /assets\/popup-[^"']+\.js/);
  assert.match(popup, /assets\/popup-[^"']+\.css/);
  assert.match(background, /updateDynamicRules/);
  assert.doesNotMatch(background, /responseHeaders/);
  assert.ok(JSON.parse(await readDist("_locales/en/messages.json")).extensionName);
  assert.ok(JSON.parse(await readDist("_locales/zh_CN/messages.json")).extensionName);
  assert.ok((await readDistBinary("icons/icon-16.png")).length > 100);
  assert.ok((await readDistBinary("icons/icon-128.png")).length > 1000);
});
