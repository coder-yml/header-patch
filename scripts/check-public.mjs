import { readdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { extname, relative } from "node:path";
import { promisify } from "node:util";

const root = new URL("../", import.meta.url);
const run = promisify(execFile);
const ignoredDirectories = new Set([".git", "node_modules", "test-results"]);
const textExtensions = new Set([
  "", ".css", ".html", ".js", ".jsx", ".json", ".md", ".mjs", ".svg", ".yaml", ".yml"
]);

const combine = (...parts) => parts.join("");
const forbidden = [
  ["company abbreviation", new RegExp(`\\b${combine("d", "x", "y")}\\b`, "i")],
  ["company domain", new RegExp(`${combine("d", "x", "y")}\\.(?:net|cn|com)`, "i")],
  ["company name", new RegExp(String.fromCodePoint(0x4e01, 0x9999, 0x56ed))],
  ["consumer brand", new RegExp(String.fromCodePoint(0x4e01, 0x9999, 0x533b, 0x751f))],
  ["consumer brand", new RegExp(String.fromCodePoint(0x4e01, 0x9999, 0x5988, 0x5988))],
  ["internal platform", new RegExp(`\\b${combine("fri", "day")}\\b`, "i")],
  ["legacy package prefix", new RegExp(`\\b${combine("b", "b", "s")}(?:[-_]|\\b)`, "i")],
  ["local user path", new RegExp(`${combine("/Us", "ers/")}`, "i")],
  ["local workspace", new RegExp(combine("Idea", "Projects"), "i")],
  ["prototype residue", new RegExp(combine("Open ", "Design"), "i")],
  ["prototype residue", new RegExp(combine("data", "-od-"), "i")],
  ["tool-specific test residue", new RegExp(`\\b${combine("Code", "x")}\\b`, "i")],
  ["local identity", new RegExp(combine("yang", "meiliang"), "i")],
  ["private test route", new RegExp(combine("newweb", "-test"), "i")],
  ["private key", new RegExp(combine("BEGIN ", "PRIVATE KEY"), "i")],
  ["access token", new RegExp(combine("gh", "p_") + "[A-Za-z0-9]+")],
  ["access token", new RegExp(combine("github", "_pat_") + "[A-Za-z0-9_]+", "i")]
];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (textExtensions.has(extname(entry.name))) files.push(path);
  }

  return files;
}

const findings = [];
function scan(path, content) {
  for (const [label, pattern] of forbidden) {
    if (pattern.test(content)) findings.push(`${path}: ${label}`);
  }
}

for (const file of await collect(root)) {
  const content = await readFile(file, "utf8");
  const path = relative(root.pathname, file.pathname);
  scan(path, content);
}

try {
  const cwd = root.pathname;
  const { stdout: metadata } = await run("git", ["log", "--all", "--format=%H%n%an <%ae>%n%cn <%ce>%n%s%n%b"], { cwd, maxBuffer: 16 * 1024 * 1024 });
  scan("git-history:metadata", metadata);
  const { stdout: objects } = await run("git", ["rev-list", "--objects", "--all"], { cwd, maxBuffer: 16 * 1024 * 1024 });
  for (const line of objects.split("\n")) {
    const separator = line.indexOf(" ");
    if (separator < 0) continue;
    const object = line.slice(0, separator);
    const path = line.slice(separator + 1);
    if (!textExtensions.has(extname(path))) continue;
    const { stdout } = await run("git", ["cat-file", "-p", object], { cwd, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    if (stdout.includes(0)) continue;
    scan(`git-history:${path}`, stdout.toString("utf8"));
  }
} catch (error) {
  findings.push(`git-history: could not scan (${error.message})`);
}

if (findings.length) {
  console.error("Public-content audit failed:\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Public-content audit passed.");
}
