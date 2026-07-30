import { useEffect, useMemo, useRef, useState } from "react";
import { buildRuleGroups } from "./groups.js";
import { ChevronIcon, CloseIcon, StackIcon } from "./icons.jsx";
import { copyText, exportableRules, parseImportedHeaders, serializeRules } from "./transfer.js";

function useDialog(open, dialogRef, onClose) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    const close = () => onClose();
    dialog.addEventListener("close", close);
    return () => dialog.removeEventListener("close", close);
  }, [open, dialogRef, onClose]);
}

function closeOnBackdrop(event) {
  if (event.target === event.currentTarget) event.currentTarget.close();
}

export function ImportDialog({ open, tr, onClose, onImport }) {
  const dialogRef = useRef(null);
  const textRef = useRef(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  useDialog(open, dialogRef, onClose);

  useEffect(() => {
    if (!open) return;
    setContent("");
    setError("");
    requestAnimationFrame(() => textRef.current?.focus());
  }, [open]);

  const submit = () => {
    const parsed = parseImportedHeaders(content);
    if (parsed.error) {
      setError(tr(parsed.error.code, parsed.error.values));
      textRef.current?.focus();
      return;
    }
    onImport(parsed.rules);
    dialogRef.current?.close();
  };

  return (
    <dialog ref={dialogRef} className="dialog import-dialog" aria-labelledby="import-title" aria-describedby="import-hint" onClick={closeOnBackdrop}>
      <div className="dialog-card">
        <header className="dialog-header">
          <h2 id="import-title">{tr("importHeaders")}</h2>
          <button className="icon-button" type="button" aria-label={tr("closeImport")} title={tr("close")} onClick={() => dialogRef.current?.close()}><CloseIcon /></button>
        </header>
        <div className="dialog-body">
          <label className="dialog-label" htmlFor="import-content">{tr("headerContent")}</label>
          <textarea
            ref={textRef}
            id="import-content"
            value={content}
            placeholder={tr("importPlaceholder")}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "import-error import-hint" : "import-hint"}
            onChange={(event) => { setContent(event.target.value); if (error) setError(""); }}
          />
          <p id="import-hint" className="dialog-hint">{tr("importHint")}</p>
          <p id="import-error" className="dialog-error" role="alert">{error}</p>
        </div>
        <footer className="dialog-footer">
          <button className="secondary-button" type="button" onClick={() => dialogRef.current?.close()}>{tr("close")}</button>
          <button className="primary-button" type="button" onClick={submit}>{tr("importAction")}</button>
        </footer>
      </div>
    </dialog>
  );
}

function SelectBox({ checked, indeterminate = false, ...props }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} {...props} />;
}

function ExportOption({ rule, selected, busy, tr, onChange, grouped = false }) {
  const displayValue = rule.value || tr("emptyValue");
  return (
    <label className={`export-option${grouped ? "" : " export-option-single"}`} data-rule-id={rule.id}>
      <input
        className="export-option-input"
        type="checkbox"
        checked={selected}
        disabled={busy}
        aria-label={tr("exportOptionLabel", { key: rule.key.trim(), value: displayValue })}
        onChange={(event) => onChange(rule.id, event.target.checked)}
      />
      <span className="export-option-copy">
        {!grouped && <strong>{rule.key.trim()}</strong>}
        <span>{displayValue}</span>
      </span>
      <span className={`export-option-state${rule.enabled ? " is-enabled" : ""}`}>{tr(rule.enabled ? "enabled" : "disabled")}</span>
    </label>
  );
}

export function ExportDialog({ open, rules, tr, onClose, onSuccess }) {
  const dialogRef = useRef(null);
  const candidates = useMemo(() => exportableRules(rules), [rules]);
  const groups = useMemo(() => buildRuleGroups(candidates), [candidates]);
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDialog(open, dialogRef, onClose);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(candidates.map((rule) => rule.id)));
    setExpanded(new Set());
    setBusy(false);
    setError("");
  }, [open, candidates]);

  const updateSelection = (ids, checked) => {
    setError("");
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => checked ? next.add(id) : next.delete(id));
      return next;
    });
  };
  const selectedCount = candidates.filter((rule) => selected.has(rule.id)).length;
  const allSelected = candidates.length > 0 && selectedCount === candidates.length;

  const copy = async () => {
    const content = serializeRules(rules, selected);
    if (!content) return;
    setBusy(true);
    setError("");
    const copied = await copyText(content).catch(() => false);
    setBusy(false);
    if (!copied) {
      setError(tr("copyFailed"));
      return;
    }
    dialogRef.current?.close();
    onSuccess(selectedCount);
  };

  return (
    <dialog ref={dialogRef} className="dialog export-dialog" aria-labelledby="export-title" aria-describedby="export-hint" onClick={closeOnBackdrop}>
      <div className="dialog-card">
        <header className="dialog-header">
          <h2 id="export-title">{tr("chooseExportHeaders")}</h2>
          <button className="icon-button" type="button" disabled={busy} aria-label={tr("closeExport")} title={tr("close")} onClick={() => dialogRef.current?.close()}><CloseIcon /></button>
        </header>
        <div className="dialog-body">
          <div className="export-summary">
            <label className="select-all">
              <SelectBox
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                disabled={busy}
                onChange={(event) => updateSelection(candidates.map((rule) => rule.id), event.target.checked)}
              />
              {tr("selectAll")}
            </label>
            <span>{tr("selectionSummary", { selected: selectedCount, total: candidates.length })}</span>
          </div>
          <p id="export-hint" className="dialog-hint">{tr("exportHint")}</p>
          <div className="export-list" role="group" aria-label={tr("exportListLabel")} aria-busy={busy}>
            {groups.map((group) => {
              if (group.rules.length === 1) {
                const rule = group.rules[0];
                return <ExportOption key={rule.id} rule={rule} selected={selected.has(rule.id)} busy={busy} tr={tr} onChange={(id, checked) => updateSelection([id], checked)} />;
              }
              const ids = group.rules.map((rule) => rule.id);
              const count = ids.filter((id) => selected.has(id)).length;
              const isExpanded = expanded.has(group.key);
              const contentId = `export-group-${group.rules[0].id}`;
              return (
                <section className="export-group" key={group.key}>
                  <header className="export-group-header">
                    <SelectBox
                      className="export-group-input"
                      checked={count === ids.length}
                      indeterminate={count > 0 && count < ids.length}
                      disabled={busy}
                      aria-label={tr("selectGroupAll", { key: group.rules[0].key.trim(), count: ids.length })}
                      onChange={(event) => updateSelection(ids, event.target.checked)}
                    />
                    <button
                      className="export-group-toggle"
                      type="button"
                      disabled={busy}
                      aria-expanded={isExpanded}
                      aria-controls={contentId}
                      aria-label={tr(isExpanded ? "collapseExportGroup" : "expandExportGroup", { key: group.rules[0].key.trim(), count: ids.length })}
                      onClick={() => setExpanded((current) => {
                        const next = new Set(current);
                        next.has(group.key) ? next.delete(group.key) : next.add(group.key);
                        return next;
                      })}
                    >
                      <span>{group.rules[0].key.trim()}</span>
                      <span className="group-count"><StackIcon />{ids.length}</span>
                      <ChevronIcon />
                    </button>
                  </header>
                  <div className="export-group-items" id={contentId} hidden={!isExpanded}>
                    {group.rules.map((rule) => <ExportOption key={rule.id} rule={rule} grouped selected={selected.has(rule.id)} busy={busy} tr={tr} onChange={(id, checked) => updateSelection([id], checked)} />)}
                  </div>
                </section>
              );
            })}
          </div>
          <p className="dialog-error" role="alert">{error}</p>
        </div>
        <footer className="dialog-footer">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => dialogRef.current?.close()}>{tr("close")}</button>
          <button className="primary-button" type="button" disabled={busy || selectedCount === 0} aria-busy={busy} onClick={copy}>{busy ? tr("copying") : tr("copyToClipboard")}</button>
        </footer>
      </div>
    </dialog>
  );
}
