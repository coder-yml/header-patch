import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = join(projectRoot, "dist");
const resultsDirectory = join(projectRoot, "test-results");
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const localeExpectations = {
  en: {
    tagline: "Request headers for Chrome · Edge",
    count0: "0 active",
    count1: "1 active",
    placeholder: "Header name",
    switchLabel: "Enable all header rules",
    ruleAdded: "Rule added",
    duplicatePattern: /Duplicate header/,
    badgeTitle5: "Header Patch · 5 request rules active"
  },
  zh: {
    tagline: "适用于 Chrome · Edge 的请求头",
    count0: "0 条生效",
    count1: "1 条生效",
    placeholder: "Header 名称",
    switchLabel: "启用全部 Header 规则",
    ruleAdded: "已新增规则",
    duplicatePattern: /重复 Header/,
    badgeTitle5: "Header Patch · 5 条请求规则生效"
  }
};

class CdpSession {
  constructor(webSocketDebuggerUrl) {
    this.socket = new WebSocket(webSocketDebuggerUrl);
    this.sequence = 0;
    this.pending = new Map();
    this.waiters = new Map();
    this.errors = [];
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
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }

      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      }
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
      const wrapped = (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      };
      this.waiters.set(method, [...(this.waiters.get(method) || []), wrapped]);
    });
  }

  async navigate(url) {
    const loaded = this.waitFor("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async screenshot(path) {
    const result = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path, Buffer.from(result.data, "base64"));
  }

  close() {
    this.socket.close();
  }
}

function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  const browser = candidates.find(existsSync);
  if (!browser) throw new Error("No supported Chrome or Edge executable found. Set BROWSER_PATH.");
  return browser;
}

function extensionIdForPath(path) {
  const digest = createHash("sha256").update(path).digest().subarray(0, 16);
  return [...digest]
    .flatMap((byte) => [byte >> 4, byte & 15])
    .map((value) => String.fromCharCode(97 + value))
    .join("");
}

async function waitForFile(path, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function launchBrowser(locale) {
  const browserPath = findBrowser();
  const profile = await mkdtemp(join(tmpdir(), "header-patch-browser-"));
  const distPath = await realpath(distDirectory);
  const processHandle = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-features=msEdgeFirstRunExperience,msEdgeSigninAllowed",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    `--disable-extensions-except=${distPath}`,
    `--load-extension=${distPath}`,
    `--lang=${locale}`,
    "about:blank"
  ], {
    env: { ...process.env, LANG: locale, LANGUAGE: locale },
    stdio: ["ignore", "ignore", "pipe"]
  });

  let stderr = "";
  processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
  processHandle.on("exit", (code) => {
    if (code && !stderr.includes("SIGTERM")) process.stderr.write(stderr);
  });

  try {
    const activePort = await waitForFile(join(profile, "DevToolsActivePort"));
    const [port] = activePort.trim().split("\n");
    return {
      cdpOrigin: `http://127.0.0.1:${port}`,
      extensionId: extensionIdForPath(distPath),
      processHandle,
      profile,
      stderr
    };
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
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png"
  })[extname(path)] || "application/octet-stream";
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
      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      const file = normalize(join(distDirectory, relativePath));
      if (relative(distDirectory, file).startsWith("..")) throw new Error("Invalid path");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
  };
}

function input(selector, value) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
  })()`;
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
  return { target, session };
}

async function closePage(browser, page) {
  page.session.close();
  const response = await fetch(`${browser.cdpOrigin}/json/close/${page.target.id}`);
  if (!response.ok) throw new Error(`Could not close browser target: ${response.status}`);
}

async function waitForSelector(session, selector, timeout = 5000) {
  try {
    await session.evaluate(`new Promise((resolvePromise, reject) => {
      const deadline = Date.now() + ${timeout};
      const check = () => {
        if (document.querySelector(${JSON.stringify(selector)})) return resolvePromise(true);
        if (Date.now() >= deadline) return reject(new Error("Selector timeout: ${selector}"));
        setTimeout(check, 25);
      };
      check();
    })`);
  } catch (error) {
    const details = await session.evaluate(`({ url: location.href, title: document.title, text: (document.body?.innerText || "").slice(0, 500) })`);
    throw new Error(`${error.message}\nPage details: ${JSON.stringify(details)}`);
  }
}

async function resolveLocale(session, requestedLocale) {
  const actualLocale = await session.evaluate(`chrome.i18n.getUILanguage()`);
  if (process.env.STRICT_LOCALES === "1") {
    assert.equal(actualLocale.toLowerCase().startsWith(requestedLocale.slice(0, 2).toLowerCase()), true);
  } else if (!actualLocale.toLowerCase().startsWith(requestedLocale.slice(0, 2).toLowerCase())) {
    console.log(`${requestedLocale} requested; browser used ${actualLocale}. Locale catalog parity is covered by unit tests.`);
  }
  return actualLocale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

async function runFullFlow(browser, origin, requestedLocale) {
  const popupUrl = `chrome-extension://${browser.extensionId}/index.html`;
  let popup = await createPage(browser, popupUrl);
  await popup.session.navigate(popupUrl);
  await popup.session.send("Emulation.setDeviceMetricsOverride", { width: 652, height: 600, deviceScaleFactor: 1, mobile: false });
  await waitForSelector(popup.session, ".rule:nth-child(5)");
  const locale = await resolveLocale(popup.session, requestedLocale);
  const expected = localeExpectations[locale];

  assert.deepEqual(await popup.session.evaluate(`({
    name: document.querySelector("h1").textContent,
    tagline: document.querySelector(".brand-copy p").textContent,
    count: document.querySelector(".rule-count").textContent,
    rows: document.querySelectorAll(".rule").length,
    tabsRemoved: document.querySelector(".tabs") === null,
    placeholder: document.querySelector(".key-input").placeholder,
    width: document.querySelector(".extension").getBoundingClientRect().width
  })`), {
    name: "Header Patch",
    tagline: expected.tagline,
    count: expected.count0,
    rows: 5,
    tabsRemoved: true,
    placeholder: expected.placeholder,
    width: 620
  });
  await popup.session.screenshot(join(resultsDirectory, `popup-full-${locale}.png`));

  await popup.session.evaluate(input(".rule:nth-child(1) .key-input", "User-Agent"));
  await popup.session.evaluate(input(".rule:nth-child(1) .value-input", "header-patch-test"));
  await sleep(300);
  assert.equal(await popup.session.evaluate(`document.querySelector(".rule-count").textContent`), expected.count1);

  await popup.session.evaluate(`document.querySelector(".check").click()`);
  await sleep(200);
  assert.equal(await popup.session.evaluate(`document.querySelector(".rule-count").textContent`), expected.count0);
  await popup.session.evaluate(`document.querySelector(".check").click()`);

  await popup.session.evaluate(`document.querySelector(".add-button").click()`);
  await waitForSelector(popup.session, ".rule:nth-child(6)");
  assert.equal(await popup.session.evaluate(`document.querySelector(".toast").textContent`), expected.ruleAdded);
  await popup.session.evaluate(`document.querySelector(".rule:last-child .remove").click()`);
  assert.equal(await popup.session.evaluate(`document.querySelectorAll(".rule").length`), 5);

  await popup.session.evaluate(input(".rule:nth-child(1) .key-input", "bad header"));
  assert.equal(await popup.session.evaluate(`document.querySelector(".rule:first-child").classList.contains("has-error")`), true);
  await popup.session.evaluate(input(".rule:nth-child(1) .key-input", "User-Agent"));
  await popup.session.evaluate(input(".rule:nth-child(2) .key-input", "user-agent"));
  await popup.session.evaluate(input(".rule:nth-child(2) .value-input", "duplicate"));
  await sleep(100);
  assert.match(await popup.session.evaluate(`document.querySelector(".rule:first-child").title`), expected.duplicatePattern);
  await popup.session.evaluate(input(".rule:nth-child(2) .key-input", "X-Header-Patch-Test"));
  await popup.session.evaluate(input(".rule:nth-child(2) .value-input", "one"));
  await popup.session.evaluate(input(".rule:nth-child(3) .key-input", "X-Header-Patch-Two"));
  await popup.session.evaluate(input(".rule:nth-child(3) .value-input", "two"));
  await popup.session.evaluate(input(".rule:nth-child(4) .key-input", "X-Header-Patch-Three"));
  await popup.session.evaluate(input(".rule:nth-child(4) .value-input", "three"));
  await popup.session.evaluate(input(".rule:nth-child(5) .key-input", "X-Header-Patch-Four"));
  await popup.session.evaluate(input(".rule:nth-child(5) .value-input", "four"));
  await sleep(350);

  const applied = await popup.session.evaluate(`Promise.all([
    chrome.storage.local.get("header-patch:state:v1"),
    chrome.declarativeNetRequest.getDynamicRules(),
    chrome.action.getBadgeText({}),
    chrome.action.getTitle({})
  ]).then(([stored, rules, badge, title]) => ({ stored, rules, badge, title }))`);
  assert.equal(applied.stored["header-patch:state:v1"].rules.length, 5);
  assert.equal(applied.rules.length, 1);
  assert.equal(applied.rules[0].action.requestHeaders.length, 5);
  assert.equal("responseHeaders" in applied.rules[0].action, false);
  assert.equal(applied.badge, "5");
  assert.equal(applied.title, expected.badgeTitle5);

  await popup.session.evaluate(`document.querySelector(".switch").click()`);
  await sleep(250);
  assert.equal(await popup.session.evaluate(`chrome.declarativeNetRequest.getDynamicRules().then((rules) => rules.length)`), 0);
  assert.equal(await popup.session.evaluate(`chrome.action.getBadgeText({})`), "OFF");
  await popup.session.screenshot(join(resultsDirectory, "popup-paused.png"));
  await popup.session.evaluate(`document.querySelector(".switch").click()`);
  await sleep(250);

  await popup.session.evaluate(input(".rule:nth-child(2) .value-input", "immediate-close"));
  await closePage(browser, popup);
  await sleep(400);
  popup = await createPage(browser, popupUrl);
  await popup.session.navigate(popupUrl);
  await waitForSelector(popup.session, ".rule:nth-child(5)");
  assert.equal(await popup.session.evaluate(`document.querySelector(".rule:nth-child(2) .value-input").value`), "immediate-close");

  const networkPage = await createPage(browser, origin);
  await networkPage.session.navigate(origin);
  const echoed = await networkPage.session.evaluate(`fetch("/echo", { cache: "no-store" }).then((response) => response.json())`);
  assert.equal(echoed.headers["user-agent"], "header-patch-test");
  assert.equal(echoed.headers["x-header-patch-test"], "immediate-close");
  assert.equal(echoed.headers["x-header-patch-two"], "two");

  const preview = await createPage(browser, origin);
  await preview.session.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 760, deviceScaleFactor: 1, mobile: false });
  await preview.session.navigate(origin);
  await waitForSelector(preview.session, ".extension");
  assert.deepEqual(await preview.session.evaluate(`(() => {
    const card = document.querySelector(".extension").getBoundingClientRect();
    return { width: card.width, radius: getComputedStyle(document.querySelector(".extension")).borderRadius };
  })()`), { width: 620, radius: "18px" });
  await preview.session.screenshot(join(resultsDirectory, "preview-desktop.png"));
  await preview.session.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 760, deviceScaleFactor: 1, mobile: true });
  await preview.session.navigate(origin);
  assert.deepEqual(await preview.session.evaluate(`(() => {
    const card = document.querySelector(".extension").getBoundingClientRect();
    return { width: card.width, radius: getComputedStyle(document.querySelector(".extension")).borderRadius };
  })()`), { width: 360, radius: "0px" });
  await preview.session.screenshot(join(resultsDirectory, "preview-narrow.png"));

  assert.deepEqual(popup.session.errors, []);
  assert.deepEqual(networkPage.session.errors, []);
  assert.deepEqual(preview.session.errors, []);
  await closePage(browser, networkPage);
  await closePage(browser, preview);
  await closePage(browser, popup);
}

async function runLocalizedSmoke(browser, origin, requestedLocale) {
  const popupUrl = `chrome-extension://${browser.extensionId}/index.html`;
  const popup = await createPage(browser, popupUrl);
  await popup.session.navigate(popupUrl);
  await popup.session.send("Emulation.setDeviceMetricsOverride", { width: 652, height: 600, deviceScaleFactor: 1, mobile: false });
  await waitForSelector(popup.session, ".rule:nth-child(5)");
  const locale = await resolveLocale(popup.session, requestedLocale);
  const expected = localeExpectations[locale];

  assert.deepEqual(await popup.session.evaluate(`({
    tagline: document.querySelector(".brand-copy p").textContent,
    count: document.querySelector(".rule-count").textContent,
    placeholder: document.querySelector(".key-input").placeholder,
    switchLabel: document.querySelector(".switch").getAttribute("aria-label")
  })`), {
    tagline: expected.tagline,
    count: expected.count0,
    placeholder: expected.placeholder,
    switchLabel: expected.switchLabel
  });

  await popup.session.evaluate(input(".rule:first-child .key-input", "X-Header-Patch-Locale"));
  await popup.session.evaluate(input(".rule:first-child .value-input", "zh-CN"));
  await sleep(300);
  assert.equal(await popup.session.evaluate(`document.querySelector(".rule-count").textContent`), expected.count1);
  await popup.session.screenshot(join(resultsDirectory, `popup-smoke-${locale}.png`));

  const networkPage = await createPage(browser, origin);
  await networkPage.session.navigate(origin);
  const echoed = await networkPage.session.evaluate(`fetch("/echo", { cache: "no-store" }).then((response) => response.json())`);
  assert.equal(echoed.headers["x-header-patch-locale"], "zh-CN");
  assert.deepEqual(popup.session.errors, []);
  assert.deepEqual(networkPage.session.errors, []);
  await closePage(browser, networkPage);
  await closePage(browser, popup);
}

if (!existsSync(join(distDirectory, "manifest.json"))) {
  throw new Error("Build output is missing. Run npm run build before npm run test:e2e.");
}

await mkdir(resultsDirectory, { recursive: true });
const localServer = await startLocalServer();

try {
  for (const [locale, flow] of [["en-US", runFullFlow], ["zh-CN", runLocalizedSmoke]]) {
    const browser = await launchBrowser(locale);
    try {
      await flow(browser, localServer.origin, locale);
      console.log(`${locale} browser flow: PASS`);
    } finally {
      await stopBrowser(browser);
    }
  }
} finally {
  await localServer.close();
}
