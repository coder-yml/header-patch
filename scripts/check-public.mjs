import { readdir, readFile } from "node:fs/promises";
import { extname, relative } from "node:path";

const root = new URL("../", import.meta.url);
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
  ["tool-specific test residue", new RegExp(`\\b${combine("Code", "x")}\\b`, "i")],
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
for (const file of await collect(root)) {
  const content = await readFile(file, "utf8");
  const path = relative(root.pathname, file.pathname);
  for (const [label, pattern] of forbidden) {
    if (pattern.test(content)) findings.push(`${path}: ${label}`);
  }
}

if (findings.length) {
  console.error("Public-content audit failed:\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Public-content audit passed.");
}
