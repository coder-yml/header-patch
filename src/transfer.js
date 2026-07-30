export function parseInlineHeader(line) {
  let match = line.match(/^([^\s=:]+)\s*=\s*(.*)$/);
  if (match) return { key: match[1].trim(), value: match[2].trim() };
  match = line.match(/^([^\s=:]+)\s*:\s*(.*)$/);
  if (match) return { key: match[1].trim(), value: match[2].trim() };
  match = line.match(/^(\S+)\s+(.+)$/);
  return match ? { key: match[1].trim(), value: match[2].trim() } : null;
}

export function parseImportedHeaders(content) {
  const lines = content.replace(/\r/g, "").split("\n")
    .map((line, index) => ({ text: line.trim(), number: index + 1 }))
    .filter((line) => line.text);

  if (!lines.length) return { rules: [], error: { code: "importEmpty" } };
  const rules = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const inline = parseInlineHeader(current.text);
    if (inline) {
      rules.push(inline);
      continue;
    }
    if (!lines[index + 1]) {
      return { rules: [], error: { code: "missingValue", values: { line: current.number } } };
    }
    rules.push({ key: current.text, value: lines[index + 1].text });
    index += 1;
  }
  return { rules, error: null };
}

export function exportableRules(rules) {
  return rules.filter((rule) => rule.key.trim());
}

export function serializeRules(rules, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  return exportableRules(rules)
    .filter((rule) => selected.has(rule.id))
    .map((rule) => `${rule.key.trim()}=${rule.value}`)
    .join("\n");
}

export async function copyText(content, documentRef = document, navigatorRef = navigator) {
  try {
    if (navigatorRef.clipboard && globalThis.isSecureContext !== false) {
      await navigatorRef.clipboard.writeText(content);
      return true;
    }
  } catch {
    // The DOM fallback below also works in older extension runtimes.
  }

  const helper = documentRef.createElement("textarea");
  const dialog = documentRef.querySelector("dialog[open]");
  const previousFocus = documentRef.activeElement;
  helper.value = content;
  helper.readOnly = true;
  helper.tabIndex = -1;
  helper.setAttribute("aria-hidden", "true");
  Object.assign(helper.style, {
    position: "fixed", left: "-9999px", top: "0", width: "1px", height: "1px", opacity: "0"
  });
  (dialog || documentRef.body).appendChild(helper);
  helper.focus({ preventScroll: true });
  helper.select();
  helper.setSelectionRange(0, helper.value.length);
  let copied = false;
  try {
    copied = helper.selectionStart === 0
      && helper.selectionEnd === helper.value.length
      && documentRef.execCommand("copy");
  } catch {
    copied = false;
  }
  helper.remove();
  previousFocus?.focus?.({ preventScroll: true });
  return Boolean(copied);
}
