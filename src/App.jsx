import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExportDialog, ImportDialog } from "./Dialogs.jsx";
import RuleList from "./RuleList.jsx";
import {
  buildRuleGroups,
  deleteRules,
  duplicateRule,
  moveRuleToTarget,
  moveRuleWithinGroup,
  moveTopLevel,
  moveTopLevelByDirection
} from "./groups.js";
import { AddIcon, BrandIcon, ExportIcon, ImportIcon } from "./icons.jsx";
import { browserLocale, t } from "./i18n.js";
import { analyzeHeaderRules, replaceHeaderRule } from "./rules.js";
import { cloneDefaultState, makeRuleId } from "./state.js";
import { exportableRules } from "./transfer.js";
import { loadLanguage, loadState, persistLanguage, persistState } from "./storage.js";

const sameOrder = (left, right) => left.length === right.length && left.every((rule, index) => rule.id === right[index]?.id);

export default function App() {
  const [state, setState] = useState(null);
  const [projectionRules, setProjectionRules] = useState([]);
  const [locale, setLocale] = useState(browserLocale());
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [focusRuleId, setFocusRuleId] = useState(null);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [recentlyMoved, setRecentlyMoved] = useState(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const [toast, setToast] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const stateRef = useRef(null);
  const projectionTimer = useRef(null);
  const toastTimer = useRef(null);
  const movedTimer = useRef(null);
  const tr = useCallback((key, values) => t(key, values, locale), [locale]);

  const showToast = useCallback((key, values, type = "success") => {
    window.clearTimeout(toastTimer.current);
    setToast({ key, values, type });
    toastTimer.current = window.setTimeout(() => setToast(null), type === "error" ? 4200 : 1800);
  }, []);

  useEffect(() => {
    let disposed = false;
    Promise.all([loadState(), loadLanguage()])
      .catch(() => {
        showToast("readFailed", undefined, "error");
        return [cloneDefaultState(), null];
      })
      .then(([loadedState, savedLocale]) => {
        if (disposed) return;
        stateRef.current = loadedState;
        setState(loadedState);
        setProjectionRules(loadedState.rules);
        setLocale(savedLocale || browserLocale());
        persistState(loadedState).catch(() => showToast("saveFailed", undefined, "error"));
      });

    const flush = () => stateRef.current && persistState(stateRef.current).catch(() => undefined);
    const clearSelection = (event) => {
      if (!event.target.closest(".rule, .rule-group, dialog")) setSelected(null);
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("pointerdown", clearSelection);
    return () => {
      disposed = true;
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("pointerdown", clearSelection);
      window.clearTimeout(projectionTimer.current);
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(movedTimer.current);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const commitState = useCallback((updater) => {
    if (!stateRef.current) return null;
    const next = typeof updater === "function" ? updater(stateRef.current) : updater;
    stateRef.current = next;
    setState(next);
    persistState(next).catch(() => showToast("saveFailed", undefined, "error"));
    return next;
  }, [showToast]);

  const restoreFocusedInput = (snapshot) => {
    if (!snapshot) return;
    requestAnimationFrame(() => {
      const input = [...document.querySelectorAll(`[data-rule-id="${snapshot.ruleId}"]`)]
        .find((element) => element.dataset.field === snapshot.field);
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange?.(snapshot.start, snapshot.end, snapshot.direction);
    });
  };

  const commitRules = useCallback((producer, deferGrouping = false) => {
    const current = stateRef.current;
    if (!current) return null;
    const nextRules = typeof producer === "function" ? producer(current.rules) : producer;
    if (nextRules === current.rules) return current.rules;
    commitState({ ...current, rules: nextRules });

    if (!deferGrouping) {
      window.clearTimeout(projectionTimer.current);
      setProjectionRules(nextRules);
    } else {
      const active = document.activeElement;
      const snapshot = active?.dataset?.ruleId ? {
        ruleId: active.dataset.ruleId,
        field: active.dataset.field,
        start: active.selectionStart,
        end: active.selectionEnd,
        direction: active.selectionDirection
      } : null;
      window.clearTimeout(projectionTimer.current);
      projectionTimer.current = window.setTimeout(() => {
        setProjectionRules(nextRules);
        restoreFocusedInput(snapshot);
      }, 320);
    }
    return nextRules;
  }, [commitState]);

  const rules = state?.rules || [];
  const analysis = useMemo(() => analyzeHeaderRules(rules), [rules]);
  const groups = useMemo(() => {
    const live = new Map(rules.map((rule) => [rule.id, rule]));
    return buildRuleGroups(projectionRules)
      .map((group) => ({ ...group, rules: group.rules.map((rule) => live.get(rule.id)).filter(Boolean) }))
      .filter((group) => group.rules.length);
  }, [projectionRules, rules]);
  const expandableKeys = useMemo(() => groups.filter((group) => group.rules.length > 1).map((group) => group.key), [groups]);
  const allExpanded = expandableKeys.length > 0 && expandableKeys.every((key) => expandedGroups.has(key));
  const appliedCount = state?.active ? analysis.count : 0;
  const hasExportableRules = exportableRules(rules).length > 0;

  useEffect(() => {
    setExpandedGroups((current) => {
      const valid = new Set(expandableKeys);
      const next = new Set([...current].filter((key) => valid.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [expandableKeys]);

  if (!state) {
    return <main className="page"><section className="extension loading" aria-label={tr("loadingLabel")}>{tr("loading")}</section></main>;
  }

  const updateRule = (nextRule, deferGrouping) => commitRules((current) => replaceHeaderRule(current, nextRule), deferGrouping);
  const removeRule = (id) => commitRules((current) => deleteRules(current, [id]));
  const removeGroup = (ids) => commitRules((current) => deleteRules(current, ids));
  const duplicate = (id) => commitRules((current) => duplicateRule(current, id, makeRuleId()));
  const addRule = () => {
    const id = makeRuleId();
    commitRules((current) => [...current, { id, enabled: false, key: "", value: "" }]);
    setFocusRuleId(id);
    requestAnimationFrame(() => setFocusRuleId(null));
  };
  const importRules = (imported) => {
    const additions = imported.map((rule) => ({ ...rule, id: makeRuleId(), enabled: false }));
    commitRules((current) => [...current, ...additions]);
    showToast("importedCount", { count: additions.length });
  };

  const move = (source, target, placementOrDirection) => {
    const current = stateRef.current.rules;
    let next = current;
    if (!target) {
      next = source.type === "member"
        ? moveRuleWithinGroup(current, source.id, placementOrDirection)
        : moveTopLevelByDirection(current, source.ids, placementOrDirection);
    } else if (source.type === "member" && target.type === "member" && source.key === target.key) {
      next = moveRuleToTarget(current, source.id, target.id, placementOrDirection);
    } else if (source.type !== "member" && target.type !== "member") {
      next = moveTopLevel(current, source.ids, target.ids, placementOrDirection);
    }
    if (sameOrder(next, current)) return false;
    commitRules(next);
    setSelected(source);
    setRecentlyMoved(source);
    window.clearTimeout(movedTimer.current);
    movedTimer.current = window.setTimeout(() => setRecentlyMoved(null), 1100);
    const nextGroups = buildRuleGroups(next);
    const position = source.type === "member"
      ? next.filter((rule) => source.key && rule.key.trim().toLocaleLowerCase("en-US") === source.key).findIndex((rule) => rule.id === source.id) + 1
      : nextGroups.findIndex((group) => group.rules.some((rule) => source.ids.includes(rule.id))) + 1;
    const total = source.type === "member" ? nextGroups.find((group) => group.key === source.key)?.rules.length || 1 : nextGroups.length;
    setMoveAnnouncement(tr("movedTo", { position, total }));
    return true;
  };

  const toggleLanguage = () => {
    const next = locale === "zh-CN" ? "en" : "zh-CN";
    setLocale(next);
    persistLanguage(next).catch(() => showToast("saveFailed", undefined, "error"));
  };

  const toggleAllGroups = () => {
    if (!expandableKeys.length) return;
    setExpandedGroups(allExpanded ? new Set() : new Set(expandableKeys));
  };

  return (
    <>
      <main className="page">
        <section className="extension" aria-label={tr("appLabel")}>
          <header className="topbar">
            <div className="brand">
              <div className="brand-mark" aria-hidden="true"><BrandIcon /></div>
              <div className="brand-copy"><h1>{tr("extensionName")}</h1><p>{tr("tagline")}</p></div>
            </div>
            <div className="top-actions">
              <button className="language-button" type="button" lang={locale === "zh-CN" ? "en" : "zh-CN"} aria-label={tr("switchLanguage")} title={tr("switchLanguage")} onClick={toggleLanguage}>{locale === "zh-CN" ? "En" : "Zh"}</button>
              <button className="group-view-button" type="button" disabled={!expandableKeys.length} aria-expanded={allExpanded} title={expandableKeys.length ? tr(allExpanded ? "collapseAll" : "expandAll") : tr("noExpandableGroups")} onClick={toggleAllGroups}>{tr(allExpanded ? "collapseAll" : "expandAll")}</button>
              <span className="rule-count" title={tr("appliedCountTitle", appliedCount)}>{tr("appliedCount", appliedCount)}</span>
              <button className="switch" type="button" role="switch" aria-checked={state.active} aria-label={tr("enableAll")} title={tr("masterSwitch")} onClick={() => commitState((current) => ({ ...current, active: !current.active }))} />
            </div>
          </header>

          <section className="rules-panel">
            {rules.length ? (
              <RuleList
                groups={groups}
                analysis={analysis}
                expandedGroups={expandedGroups}
                editingRuleId={editingRuleId}
                focusRuleId={focusRuleId}
                selected={selected}
                recentlyMoved={recentlyMoved}
                tr={tr}
                onUpdate={updateRule}
                onRemove={removeRule}
                onDuplicate={duplicate}
                onDeleteGroup={removeGroup}
                onToggleGroup={(key) => setExpandedGroups((current) => {
                  const next = new Set(current);
                  next.has(key) ? next.delete(key) : next.add(key);
                  return next;
                })}
                onEditing={setEditingRuleId}
                onSelect={setSelected}
                onMove={move}
              />
            ) : <div className="empty-state">{tr("emptyState")}</div>}
          </section>

          <footer className="footer">
            <button className="add-button" type="button" aria-label={tr("addRule")} title={tr("addRuleTitle")} onClick={addRule}><AddIcon /><span>{tr("addRule")}</span></button>
            <button className="footer-icon-button" type="button" aria-label={tr("importHeaders")} title={tr("importHeaders")} onClick={() => setImportOpen(true)}><ImportIcon /></button>
            <button className="footer-icon-button" type="button" disabled={!hasExportableRules} aria-label={tr(hasExportableRules ? "chooseExportHeaders" : "noExportableHeaders")} title={tr(hasExportableRules ? "exportHeaders" : "noExportableHeaders")} onClick={() => setExportOpen(true)}><ExportIcon /></button>
          </footer>
        </section>
      </main>

      <ImportDialog open={importOpen} tr={tr} onClose={() => setImportOpen(false)} onImport={importRules} />
      <ExportDialog open={exportOpen} rules={rules} tr={tr} onClose={() => setExportOpen(false)} onSuccess={(count) => showToast("copiedCount", { count })} />
      <div className="sr-only" role="status" aria-live="polite">{moveAnnouncement}</div>
      <div className={`toast${toast ? " is-visible" : ""}${toast?.type === "error" ? " is-error" : ""}`} role={toast?.type === "error" ? "alert" : "status"} aria-live={toast?.type === "error" ? "assertive" : "polite"}>{toast ? tr(toast.key, toast.values) : ""}</div>
    </>
  );
}
