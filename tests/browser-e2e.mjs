import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = join(projectRoot, "dist");
const resultsDirectory = join(projectRoot, "test-results");
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const expectedLocales = {
  en: { tagline: "Request headers for Chrome · Edge", count0: "0 active", count1: "1 active", placeholder: "Header name", switchLabel: "Enable all Headers" },
  zh: { tagline: "适用于 Chrome · Edge 的请求头", count0: "0 条生效", count1: "1 条生效", placeholder: "Header 名称", switchLabel: "启用全部 Header" }
};

class CdpSession {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.waiters = new Map();
    this.errors = [];
    this.requests = [];
  }

  async connect() {
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener("open", resolvePromise, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") this.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === "Network.requestWillBeSent") this.requests.push(message.params.request.url);
      const waiters = this.waiters.get(message.method) || [];
      this.waiters.delete(message.method);
      waiters.forEach((resolvePromise) => resolvePromise(message.params));
    });
    return this;
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method, timeout = 10000) {
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const wrapped = (value) => { clearTimeout(timer); resolvePromise(value); };
      this.waiters.set(method, [...(this.waiters.get(method) || []), wrapped]);
    });
  }

  async navigate(url) {
    const loaded = this.waitFor("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async screenshot(path) {
    const result = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path, Buffer.from(result.data, "base64"));
  }

  close() { this.socket.close(); }
}

function findBrowser() {
  const cached = [];
  for (const root of [join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/ms-playwright"), join(homedir(), ".cache/puppeteer/chrome")]) {
    if (!existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const directory = stack.pop();
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) stack.push(path);
        else if (entry.isFile() && (
          path.endsWith("Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
          || /chrome-(?:linux|linux64)[^/]*\/chrome$/.test(path)
        )) cached.push(path);
      }
    }
  }
  const candidates = [
    process.env.BROWSER_PATH,
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ...cached.toSorted().toReversed()
  ].filter(Boolean);
  const browser = candidates.find(existsSync);
  if (!browser) throw new Error("Chrome for Testing is required to load an unpacked extension. Set BROWSER_PATH to its executable.");
  return browser;
}

function extensionIdForPath(path) {
  const digest = createHash("sha256").update(path).digest().subarray(0, 16);
  return [...digest].flatMap((byte) => [byte >> 4, byte & 15]).map((value) => String.fromCharCode(97 + value)).join("");
}

async function waitForFile(path, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { return await readFile(path, "utf8"); } catch { await sleep(100); }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function launchBrowser(locale) {
  const profile = await mkdtemp(join(tmpdir(), "header-patch-browser-"));
  const distPath = await realpath(distDirectory);
  const processHandle = spawn(findBrowser(), [
    "--headless=new",
    "--disable-gpu",
    ...(process.env.CI ? ["--no-sandbox"] : []),
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--metrics-recording-only",
    "--safebrowsing-disable-auto-update",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    `--disable-extensions-except=${distPath}`,
    `--load-extension=${distPath}`,
    `--lang=${locale}`,
    "about:blank"
  ], { env: { ...process.env, LANG: locale, LANGUAGE: locale }, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    const [port] = (await waitForFile(join(profile, "DevToolsActivePort"))).trim().split("\n");
    return { cdpOrigin: `http://127.0.0.1:${port}`, extensionId: extensionIdForPath(distPath), processHandle, profile, stderr };
  } catch (error) {
    processHandle.kill("SIGTERM");
    await rm(profile, { recursive: true, force: true });
    throw new Error(`${error.message}\n${stderr}`);
  }
}

async function stopBrowser(browser) {
  if (browser.processHandle.exitCode === null) {
    browser.processHandle.kill("SIGTERM");
    await Promise.race([
      new Promise((resolvePromise) => browser.processHandle.once("exit", resolvePromise)),
      sleep(3000).then(() => browser.processHandle.kill("SIGKILL"))
    ]);
  }
  await rm(browser.profile, { recursive: true, force: true });
}

function contentType(path) {
  return ({ ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png" })[extname(path)] || "application/octet-stream";
}

async function startLocalServer() {
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/echo") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ headers: request.headers }));
        return;
      }
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      const file = normalize(join(distDirectory, pathname === "/" ? "index.html" : pathname.slice(1)));
      if (relative(distDirectory, file).startsWith("..")) throw new Error("Invalid path");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  await new Promise((resolvePromise, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePromise); });
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())) };
}

async function json(browser, path, options) {
  const response = await fetch(`${browser.cdpOrigin}${path}`, options);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function createPage(browser, url) {
  const target = await json(browser, `/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const session = await new CdpSession(target.webSocketDebuggerUrl).connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Network.enable");
  return { target, session };
}

async function closePage(browser, page) {
  page.session.close();
  const response = await fetch(`${browser.cdpOrigin}/json/close/${page.target.id}`);
  if (!response.ok) throw new Error(`Could not close target: ${response.status}`);
}

async function waitForNewTarget(browser, existingIds, predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const targets = await json(browser, "/json/list");
    const target = targets.find((candidate) => !existingIds.has(candidate.id) && predicate(candidate));
    if (target) return target;
    await sleep(50);
  }
  throw new Error("Timed out waiting for browser target");
}

async function waitForSelector(session, selector, timeout = 5000) {
  await session.evaluate(`new Promise((resolvePromise, reject) => {
    const deadline = Date.now() + ${timeout};
    const check = () => {
      if (document.querySelector(${JSON.stringify(selector)})) return resolvePromise(true);
      if (Date.now() >= deadline) return reject(new Error("Selector timeout: ${selector}"));
      setTimeout(check, 25);
    };
    check();
  })`);
}

async function waitForCondition(session, expression, timeout = 5000) {
  await session.evaluate(`new Promise((resolvePromise, reject) => {
    const deadline = Date.now() + ${timeout};
    const check = () => {
      try { if (${expression}) return resolvePromise(true); } catch (_) {}
      if (Date.now() >= deadline) return reject(new Error("Condition timeout"));
      setTimeout(check, 25);
    };
    check();
  })`);
}

function setValue(selector, value) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
  })()`;
}

async function dragWithMouse(session, sourceSelector, targetSelector) {
  const points = await session.evaluate(`(() => {
    const source = document.querySelector(${JSON.stringify(sourceSelector)}).getBoundingClientRect();
    const target = document.querySelector(${JSON.stringify(targetSelector)}).getBoundingClientRect();
    return { source: { x: source.left + source.width / 2, y: source.top + source.height / 2 }, target: { x: target.left + target.width / 2, y: target.bottom - 2 } };
  })()`);
  await session.send("Input.setInterceptDrags", { enabled: true });
  const intercepted = session.waitFor("Input.dragIntercepted", 5000);
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...points.source });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", ...points.source, button: "left", clickCount: 1 });
  for (let step = 1; step <= 8; step += 1) {
    await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.source.x + (points.target.x - points.source.x) * step / 8, y: points.source.y + (points.target.y - points.source.y) * step / 8, button: "left", buttons: 1 });
    await sleep(25);
  }
  const { data } = await intercepted;
  await session.send("Input.dispatchDragEvent", { type: "dragEnter", ...points.target, data });
  await session.send("Input.dispatchDragEvent", { type: "dragOver", ...points.target, data });
  await session.send("Input.dispatchDragEvent", { type: "drop", ...points.target, data });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...points.target, button: "left", clickCount: 1 });
  await session.send("Input.setInterceptDrags", { enabled: false });
  await sleep(300);
}

function assertLocalRequests(session) {
  const unexpected = session.requests.filter((url) => !url.startsWith("chrome-extension://") && !url.startsWith("http://127.0.0.1:") && !url.startsWith("data:") && url !== "about:blank");
  assert.deepEqual(unexpected, []);
}

async function resolveLocale(session, requested) {
  const actual = await session.evaluate("chrome.i18n.getUILanguage()");
  if (process.env.STRICT_LOCALES === "1") assert.equal(actual.toLowerCase().startsWith(requested.slice(0, 2).toLowerCase()), true);
  return actual.toLowerCase().startsWith("zh") ? "zh" : "en";
}

async function seedStorage(browser, state) {
  const popupUrl = `chrome-extension://${browser.extensionId}/index.html`;
  const page = await createPage(browser, popupUrl);
  await page.session.navigate(popupUrl);
  await waitForSelector(page.session, ".empty-state");
  const response = await page.session.evaluate(`chrome.runtime.sendMessage({ type: "SAVE_STATE", state: ${JSON.stringify(state)} })`);
  assert.equal(response?.ok, true, `Could not seed extension state: ${JSON.stringify(response)}`);
  return page;
}

async function runMainFlow(browser, origin, requestedLocale) {
  const popupUrl = `chrome-extension://${browser.extensionId}/index.html`;
  let popup = await createPage(browser, popupUrl);
  await popup.session.send("Emulation.setDeviceMetricsOverride", { width: 652, height: 600, deviceScaleFactor: 1, mobile: false });
  await popup.session.navigate(popupUrl);
  await waitForSelector(popup.session, ".empty-state");
  const locale = await resolveLocale(popup.session, requestedLocale);
  const expected = expectedLocales[locale];

  const initialLayout = await popup.session.evaluate(`({
    name: document.querySelector("h1").textContent,
    tagline: document.querySelector(".brand-copy p").textContent,
    count: document.querySelector(".rule-count").textContent,
    rows: document.querySelectorAll(".rule").length,
    exportDisabled: document.querySelector(".footer-icon-button:last-child").disabled,
    switchLabel: document.querySelector(".switch").getAttribute("aria-label"),
    width: document.querySelector(".extension").getBoundingClientRect().width,
    height: document.querySelector(".extension").getBoundingClientRect().height,
    brand: (() => { const mark = document.querySelector(".brand-mark"); const box = mark.getBoundingClientRect(); const style = getComputedStyle(mark); return { width: box.width, height: box.height, radius: style.borderRadius, background: style.backgroundColor, svg: mark.querySelector("svg").getBoundingClientRect().width }; })()
  })`);
  assert.deepEqual({ ...initialLayout, height: undefined }, { name: "Header Patch", tagline: expected.tagline, count: expected.count0, rows: 0, exportDisabled: true, switchLabel: expected.switchLabel, width: 620, height: undefined, brand: { width: 32, height: 32, radius: "9px", background: "oklch(0.19 0.014 250)", svg: 18 } });
  assert.ok(initialLayout.height >= 260 && initialLayout.height <= 265, `Unexpected content-sized popup height: ${initialLayout.height}`);

  for (let index = 0; index < 3; index += 1) await popup.session.evaluate(`document.querySelector(".add-button").click()`);
  await waitForCondition(popup.session, `document.querySelectorAll(".rule").length === 3`);
  assert.deepEqual(await popup.session.evaluate(`[...document.querySelectorAll(".check")].map((check) => check.getAttribute("aria-checked"))`), ["false", "false", "false"]);
  const ids = await popup.session.evaluate(`[...document.querySelectorAll(".rule")].map((rule) => rule.dataset.ruleId)`);
  const [firstId, middleId, lastId] = ids;
  const field = (id, name) => `[data-rule-id="${id}"] .${name}-input`;
  await popup.session.evaluate(setValue(field(firstId, "key"), "User-Agent"));
  await popup.session.evaluate(setValue(field(firstId, "value"), "header-patch-test"));
  await popup.session.evaluate(setValue(field(middleId, "key"), "X-Middle"));
  await popup.session.evaluate(setValue(field(middleId, "value"), "middle"));
  await popup.session.evaluate(setValue(field(lastId, "key"), " user-agent "));
  await popup.session.evaluate(setValue(field(lastId, "value"), "later"));
  for (const id of ids) await popup.session.evaluate(`document.querySelector('[data-rule-id="${id}"] .check').click()`);
  await sleep(500);

  const grouped = await popup.session.evaluate(`Promise.all([
    chrome.storage.local.get("header-patch:state:v1"), chrome.declarativeNetRequest.getDynamicRules()
  ]).then(([stored, dynamic]) => ({
    order: stored["header-patch:state:v1"].rules.map((rule) => rule.id),
    enabled: stored["header-patch:state:v1"].rules.map((rule) => rule.enabled),
    top: [...document.querySelector(".rules").children].map((item) => item.classList.contains("rule-group") ? "group" : item.dataset.ruleId),
    collapsedVisible: document.querySelector(".rule-group .rule").dataset.ruleId,
    userAgent: dynamic[0].action.requestHeaders.find((header) => header.header.toLowerCase() === "user-agent").value
  }))`);
  assert.deepEqual(grouped.order, [firstId, middleId, lastId]);
  assert.deepEqual(grouped.enabled, [false, true, true]);
  assert.deepEqual(grouped.top, ["group", middleId]);
  assert.equal(grouped.collapsedVisible, lastId);
  assert.equal(grouped.userAgent, "later");
  await popup.session.evaluate(`(() => {
    const input = document.querySelector('[data-rule-id="${lastId}"] .key-input');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "USER-AGENT");
    input.setSelectionRange(4, 4);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await sleep(450);
  assert.deepEqual(await popup.session.evaluate(`({ id: document.activeElement.dataset.ruleId, caret: document.activeElement.selectionStart, expanded: document.querySelector(".rule-group").classList.contains("is-expanded") })`), { id: lastId, caret: 4, expanded: false });
  await popup.session.evaluate(`document.querySelector(".group-view-button").click()`);
  await waitForSelector(popup.session, ".rule-group.is-expanded");
  await popup.session.evaluate(`document.querySelector(".group-view-button").click()`);
  await waitForCondition(popup.session, `!document.querySelector(".rule-group").classList.contains("is-expanded")`);
  await popup.session.screenshot(join(resultsDirectory, `popup-collapsed-${locale}.png`));

  await popup.session.evaluate(`document.querySelector(".group-view-button").click()`);
  await waitForSelector(popup.session, ".rule-group.is-expanded");
  assert.deepEqual(await popup.session.evaluate(`[...document.querySelectorAll(".rules .rule")].map((rule) => rule.dataset.ruleId)`), [firstId, lastId, middleId]);
  await popup.session.screenshot(join(resultsDirectory, `popup-expanded-${locale}.png`));

  await popup.session.evaluate(`document.querySelector('[data-rule-id="${firstId}"] .check').click()`);
  await sleep(250);
  assert.deepEqual(await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules.map((rule) => rule.enabled))`), [true, true, false]);

  await popup.session.evaluate(`document.querySelector('[data-rule-id="${firstId}"] .duplicate').click()`);
  await sleep(250);
  const duplicateState = await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules)`);
  const copyId = duplicateState[1].id;
  assert.deepEqual(duplicateState.map((rule) => rule.id), [firstId, copyId, middleId, lastId]);
  assert.deepEqual(duplicateState.filter((rule) => rule.key.trim().toLowerCase() === "user-agent").map((rule) => rule.enabled), [false, true, false]);
  assert.equal(await popup.session.evaluate(`document.querySelector(".rule-group .group-count").textContent.trim()`), "3");

  await popup.session.evaluate(`(() => { const handle = document.querySelector('[data-rule-id="${middleId}"] .drag-handle'); handle.focus(); handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); })()`);
  await sleep(250);
  assert.equal((await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules[0].id)`)), middleId);
  assert.equal(await popup.session.evaluate(`document.querySelector('[data-rule-id="${middleId}"]').classList.contains("is-recently-moved")`), true);

  const beforeMouseDrag = await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules.map((rule) => rule.id).join(","))`);
  await dragWithMouse(popup.session, `.rule-group [data-rule-id="${firstId}"] .drag-handle`, `.rule-group [data-rule-id="${lastId}"] .drag-handle`);
  const afterMouseDrag = await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules.map((rule) => rule.id).join(","))`);
  assert.notEqual(afterMouseDrag, beforeMouseDrag);

  await popup.session.evaluate(`document.querySelectorAll(".footer-icon-button")[0].click()`);
  await waitForSelector(popup.session, ".import-dialog[open]");
  assert.deepEqual(await popup.session.evaluate(`(() => {
    const dialog = document.querySelector(".import-dialog").getBoundingClientRect();
    const textarea = document.querySelector(".import-textarea").getBoundingClientRect();
    const close = document.querySelector(".import-close").getBoundingClientRect();
    return { dialog: [dialog.width, dialog.height], textarea: [textarea.width, textarea.height], close: [close.width, close.height] };
  })()`), { dialog: [520, 363], textarea: [486, 180], close: [44, 44] });
  await popup.session.screenshot(join(resultsDirectory, "dialog-import.png"));
  await popup.session.evaluate(setValue("#import-content", "X-Missing"));
  await popup.session.evaluate(`document.querySelector(".import-dialog .import-submit").click()`);
  assert.match(await popup.session.evaluate(`document.querySelector("#import-error").textContent`), /1/);
  await popup.session.evaluate(setValue("#import-content", "X-Import=one\nX-Pair\npair value\nX-Colon: three"));
  await popup.session.evaluate(`document.querySelector(".import-dialog .import-submit").click()`);
  await waitForCondition(popup.session, `!document.querySelector(".import-dialog").open`);
  assert.equal((await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules.slice(-3).every((rule) => !rule.enabled))`)), true);

  await popup.session.evaluate(`document.querySelectorAll(".footer-icon-button")[1].click()`);
  await waitForSelector(popup.session, ".export-dialog[open]");
  await waitForCondition(popup.session, `!document.querySelector(".export-submit").disabled`);
  await sleep(150);
  assert.deepEqual(await popup.session.evaluate(`(() => { const button = document.querySelector(".export-submit"); return { disabled: button.disabled, busy: button.getAttribute("aria-busy"), background: getComputedStyle(button).backgroundColor }; })()`), { disabled: false, busy: "false", background: "oklch(0.19 0.014 250)" });
  await popup.session.screenshot(join(resultsDirectory, "dialog-export.png"));
  await popup.session.evaluate(`document.querySelector(".export-group-toggle").click()`);
  await popup.session.evaluate(`document.querySelector(".export-group-items .export-option-input").click()`);
  assert.equal(await popup.session.evaluate(`document.querySelector(".export-group-input").indeterminate`), true);
  await popup.session.evaluate(`document.querySelector(".export-select-all input").click()`);
  await popup.session.evaluate(`(() => {
    window.__copied = "";
    try { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.__copied = value; } } }); } catch (_) {}
    document.execCommand = () => { window.__copied = document.activeElement.value || "fallback"; return true; };
  })()`);
  await popup.session.evaluate(`document.querySelector(".export-dialog .export-submit").click()`);
  await waitForCondition(popup.session, `!document.querySelector(".export-dialog").open`);
  await sleep(100);
  const copied = await popup.session.evaluate(`window.__copied`);
  assert.match(copied, /User-Agent=header-patch-test|user-agent=later/);
  assert.match(copied, /X-Import=one/);

  await popup.session.evaluate(`document.querySelectorAll(".footer-icon-button")[1].click()`);
  await waitForSelector(popup.session, ".export-dialog[open]");
  await popup.session.evaluate(`(() => {
    try { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }); } catch (_) {}
    document.execCommand = () => false;
    document.querySelector(".export-dialog .export-submit").click();
  })()`);
  await waitForCondition(popup.session, `document.querySelector(".export-dialog .export-error").textContent.length > 0`);
  assert.equal(await popup.session.evaluate(`document.querySelector(".export-dialog").open`), true);
  await popup.session.evaluate(`document.querySelector(".export-dialog .export-close").click()`);

  const initialLanguage = await popup.session.evaluate(`document.documentElement.lang`);
  await popup.session.evaluate(`document.querySelector(".language-toggle").click()`);
  const switchedLanguage = await popup.session.evaluate(`({ lang: document.documentElement.lang, add: document.querySelector(".add-button").getAttribute("aria-label") })`);
  assert.deepEqual(switchedLanguage, initialLanguage === "zh-CN" ? { lang: "en", add: "Add Header" } : { lang: "zh-CN", add: "添加 Header" });
  await popup.session.evaluate(`document.querySelector(".language-toggle").click()`);
  assert.equal(await popup.session.evaluate(`chrome.storage.local.get("header-patch:locale:v1").then((stored) => stored["header-patch:locale:v1"])`), initialLanguage === "zh-CN" ? "zh-CN" : "en");
  if (initialLanguage !== "en") await popup.session.evaluate(`document.querySelector(".language-toggle").click()`);
  assert.equal(await popup.session.evaluate(`document.documentElement.lang`), "en");
  await sleep(1900);
  await popup.session.evaluate(`document.querySelector(".topbar").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
  await popup.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  await sleep(100);
  await popup.session.screenshot(join(resultsDirectory, "popup-docs-en.png"));
  if (initialLanguage !== "en") await popup.session.evaluate(`document.querySelector(".language-toggle").click()`);

  await popup.session.evaluate(`document.querySelector(".switch").click()`);
  await sleep(200);
  assert.equal(await popup.session.evaluate(`chrome.declarativeNetRequest.getDynamicRules().then((rules) => rules.length)`), 0);
  assert.equal(await popup.session.evaluate(`chrome.action.getBadgeText({})`), "OFF");
  await popup.session.evaluate(`document.querySelector(".switch").click()`);
  await sleep(250);

  const networkPage = await createPage(browser, `${origin}/`);
  await networkPage.session.navigate(`${origin}/`);
  const echoed = await networkPage.session.evaluate(`fetch("/echo", { cache: "no-store" }).then((response) => response.json())`);
  assert.equal(echoed.headers["user-agent"], "header-patch-test");
  assert.equal(echoed.headers["x-middle"], "middle");
  assert.equal(echoed.headers["x-import"], undefined);

  assert.deepEqual(await popup.session.evaluate(`({
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    panelScrolls: document.querySelector(".rules-panel").scrollHeight >= document.querySelector(".rules-panel").clientHeight,
    disabledOpacity: getComputedStyle(document.querySelector(".rule .check[aria-checked='false']").closest(".rule")).opacity
  })`), { horizontalOverflow: false, panelScrolls: true, disabledOpacity: "1" });

  const persistedOrder = await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules.map((rule) => rule.id))`);
  await closePage(browser, popup);
  popup = await createPage(browser, popupUrl);
  await popup.session.send("Emulation.setDeviceMetricsOverride", { width: 652, height: 600, deviceScaleFactor: 1, mobile: false });
  await popup.session.navigate(popupUrl);
  await waitForSelector(popup.session, ".rules");
  assert.deepEqual(await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules.map((rule) => rule.id))`), persistedOrder);

  const preview = await createPage(browser, origin);
  for (const [width, height, name] of [[900, 760, "desktop"], [520, 700, "compact"], [360, 700, "narrow"]]) {
    await preview.session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 520 });
    await preview.session.navigate(origin);
    await waitForSelector(preview.session, ".empty-state");
    const layout = await preview.session.evaluate(`(() => {
      const card = document.querySelector(".extension").getBoundingClientRect();
      const topbar = document.querySelector(".topbar").getBoundingClientRect();
      const empty = document.querySelector(".empty-state").getBoundingClientRect();
      const add = document.querySelector(".add-button").getBoundingClientRect();
      return { width: card.width, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, topbar: topbar.height, empty: [empty.x, empty.width], add: add.width };
    })()`);
    assert.equal(layout.overflow, false);
    assert.equal(layout.width, width <= 520 ? width : 620);
    if (width === 520) assert.deepEqual({ topbar: layout.topbar, empty: layout.empty, add: layout.add }, { topbar: 119, empty: [14, 492], add: 392 });
    if (width === 360) assert.deepEqual({ topbar: layout.topbar, empty: layout.empty, add: layout.add }, { topbar: 115, empty: [14, 332], add: 232 });
    await preview.session.screenshot(join(resultsDirectory, `preview-${name}.png`));
  }

  assert.deepEqual(popup.session.errors, []);
  assert.deepEqual(networkPage.session.errors, []);
  assert.deepEqual(preview.session.errors, []);
  assertLocalRequests(popup.session);
  assertLocalRequests(networkPage.session);
  assertLocalRequests(preview.session);
  await popup.session.evaluate(`document.querySelector(".rule-group .group-toggle").click()`);
  await waitForSelector(popup.session, ".rule-group.is-expanded");
  await popup.session.evaluate(`document.querySelector(".rule-group .group-remove").click()`);
  await waitForCondition(popup.session, `!document.querySelector(".rule-group")`);
  assert.equal(await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules.some((rule) => rule.key.trim().toLowerCase() === "user-agent"))`), false);
  const removedId = await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules.find((rule) => rule.key === "X-Import").id)`);
  await popup.session.evaluate(`document.querySelector('[data-rule-id="${removedId}"] .remove').click()`);
  await waitForCondition(popup.session, `!document.querySelector('[data-rule-id="${removedId}"]')`);
  await closePage(browser, networkPage);
  await closePage(browser, preview);
  await closePage(browser, popup);
}

async function runUpgradeFlow(browser, origin, requestedLocale) {
  const legacyState = {
    active: true,
    rules: { request: [
      { id: "req-1", enabled: true, key: "", value: "" },
      { id: "legacy-first", enabled: true, key: "X-Legacy", value: "first" },
      { id: "custom-blank", enabled: false, key: "", value: "" },
      { id: "legacy-last", enabled: true, key: "x-legacy", value: "last" }
    ] }
  };
  const seedPage = await seedStorage(browser, legacyState);
  const popupUrl = `chrome-extension://${browser.extensionId}/index.html`;
  const popup = await createPage(browser, popupUrl);
  await popup.session.send("Emulation.setDeviceMetricsOverride", { width: 652, height: 600, deviceScaleFactor: 1, mobile: false });
  await popup.session.navigate(popupUrl);
  await waitForSelector(popup.session, ".rule-group");
  const locale = await resolveLocale(popup.session, requestedLocale);
  assert.equal(locale, "zh");
  assert.equal(await popup.session.evaluate(`document.querySelector(".brand-copy p").textContent`), expectedLocales.zh.tagline);
  await waitForCondition(popup.session, `window.chrome && document.querySelectorAll(".rule").length === 2`);
  const normalized = await popup.session.evaluate(`chrome.storage.local.get("header-patch:state:v1").then((stored) => stored["header-patch:state:v1"].rules)`);
  assert.deepEqual(normalized.map((rule) => rule.id), ["legacy-first", "custom-blank", "legacy-last"]);
  assert.deepEqual(normalized.map((rule) => rule.enabled), [false, false, true]);
  await popup.session.screenshot(join(resultsDirectory, "popup-upgrade-zh.png"));

  const networkPage = await createPage(browser, origin);
  await networkPage.session.navigate(origin);
  const echoed = await networkPage.session.evaluate(`fetch("/echo", { cache: "no-store" }).then((response) => response.json())`);
  assert.equal(echoed.headers["x-legacy"], "last");
  assert.deepEqual(popup.session.errors, []);
  assert.deepEqual(networkPage.session.errors, []);
  assertLocalRequests(popup.session);
  assertLocalRequests(networkPage.session);
  await closePage(browser, networkPage);
  await closePage(browser, popup);
  await closePage(browser, seedPage);
}

async function verifyActionPopupLayout(browser) {
  const popupUrl = `chrome-extension://${browser.extensionId}/index.html`;
  const controller = await createPage(browser, popupUrl);
  await controller.session.navigate(popupUrl);
  await waitForSelector(controller.session, ".extension:not(.loading)");
  const saveResponse = await controller.session.evaluate(`chrome.runtime.sendMessage({ type: "SAVE_STATE", state: {
    version: 1,
    active: true,
    rules: Array.from({ length: 6 }, (_, index) => ({
      id: "runtime-group-" + index,
      enabled: index === 3,
      key: index % 2 ? "x-runtime-group" : "X-Runtime-Group",
      value: "value-" + index
    }))
  } })`);
  assert.equal(saveResponse?.ok, true, `Could not seed action popup state: ${JSON.stringify(saveResponse)}`);
  const existingIds = new Set((await json(browser, "/json/list")).map((target) => target.id));
  const opened = await controller.session.evaluate(`chrome.action.openPopup().then(() => true, () => false)`);
  assert.equal(opened, true, "The browser action popup did not open");
  const target = await waitForNewTarget(browser, existingIds, (candidate) => candidate.url === popupUrl);
  const session = await new CdpSession(target.webSocketDebuggerUrl).connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Network.enable");
  await waitForSelector(session, ".rule-group .rule.is-group-collapsed");
  const layout = await session.evaluate(`(() => {
    const extension = document.querySelector(".extension").getBoundingClientRect();
    const rules = document.querySelector(".rules-panel").getBoundingClientRect();
    const row = document.querySelector(".rule").getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight],
      extension: [extension.width, extension.height],
      rulesHeight: rules.height,
      row: [row.top, row.bottom],
      visibleId: document.querySelector(".rule").dataset.ruleId,
      groupCount: document.querySelector(".group-count").textContent.trim()
    };
  })()`);
  assert.ok(layout.viewport[0] >= 640 && layout.viewport[0] <= 652, `Unexpected action popup width: ${JSON.stringify(layout)}`);
  assert.ok(layout.rulesHeight >= 50, `Action popup rules area is compressed: ${JSON.stringify(layout)}`);
  assert.ok(layout.row[0] >= 0 && layout.row[1] <= layout.viewport[1], `Action popup row is clipped: ${JSON.stringify(layout)}`);
  assert.equal(layout.visibleId, "runtime-group-3");
  assert.equal(layout.groupCount, "6");
  await session.screenshot(join(resultsDirectory, "popup-action-runtime.png"));
  assertLocalRequests(session);
  session.close();
  const response = await fetch(`${browser.cdpOrigin}/json/close/${target.id}`);
  if (!response.ok) throw new Error(`Could not close action popup target: ${response.status}`);
  await closePage(browser, controller);
}

if (!existsSync(join(distDirectory, "manifest.json"))) throw new Error("Build output is missing. Run npm run build before npm run test:e2e.");
await mkdir(resultsDirectory, { recursive: true });
const server = await startLocalServer();
try {
  for (const [locale, flow] of [["en-US", runMainFlow], ["zh-CN", runUpgradeFlow]]) {
    const browser = await launchBrowser(locale);
    try {
      await flow(browser, server.origin, locale);
      if (locale === "en-US") await verifyActionPopupLayout(browser);
      console.log(`${locale} browser flow: PASS`);
    } finally {
      await stopBrowser(browser);
    }
  }
} finally {
  await server.close();
}
