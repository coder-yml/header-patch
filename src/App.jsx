import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExportDialog, ImportDialog } from "./Dialogs.jsx";
import RuleList from "./RuleList.jsx";
import {
  buildRuleGroups,
  deleteRules,
  duplicateRule,
  effectiveRule,
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
  const [transientExpandedKey, setTransientExpandedKey] = useState(null);
  const [focusRuleId, setFocusRuleId] = useState(null);
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

  const captureFocusedInput = () => {
    const active = document.activeElement;
    return active?.dataset?.ruleId ? {
      ruleId: active.dataset.ruleId,
      field: active.dataset.field,
      start: active.selectionStart,
      end: active.selectionEnd,
      direction: active.selectionDirection
    } : null;
  };

  const transientKeyFor = (nextRules, snapshot) => {
    if (!snapshot) return null;
    const group = buildRuleGroups(nextRules).find((candidate) => candidate.rules.length > 1 && candidate.rules.some((rule) => rule.id === snapshot.ruleId));
    return group && effectiveRule(group).id !== snapshot.ruleId ? group.key : null;
  };

  const commitRules = useCallback((producer, options = {}) => {
    const current = stateRef.current;
    if (!current) return null;
    const nextRules = typeof producer === "function" ? producer(current.rules) : producer;
    if (nextRules === current.rules) return current.rules;
    commitState({ ...current, rules: nextRules });

    const projection = options.projection || "immediate";
    const transient = options.transient || "clear";
    const snapshot = options.snapshot || null;
    const applyProjection = () => {
      if (projection !== "preserve") setProjectionRules(nextRules);
      if (transient === "derive") setTransientExpandedKey(transientKeyFor(nextRules, snapshot));
      if (transient === "clear") setTransientExpandedKey(null);
      restoreFocusedInput(snapshot);
    };

    if (projection === "preserve") {
      if (transient === "clear") setTransientExpandedKey(null);
      return nextRules;
    }

    window.clearTimeout(projectionTimer.current);
    if (projection === "deferred") projectionTimer.current = window.setTimeout(applyProjection, 320);
    else applyProjection();
    return nextRules;
  }, [commitState]);

  const rules = state?.rules || [];
  const analysis = useMemo(() => analyzeHeaderRules(rules), [rules]);
  const projectedRules = useMemo(() => {
    const live = new Map(rules.map((rule) => [rule.id, rule]));
    return projectionRules.map((rule) => live.get(rule.id)).filter(Boolean);
  }, [projectionRules, rules]);
  const groups = useMemo(() => {
    const live = new Map(rules.map((rule) => [rule.id, rule]));
    return buildRuleGroups(projectionRules)
      .map((group) => ({ ...group, rules: group.rules.map((rule) => live.get(rule.id)).filter(Boolean) }))
      .filter((group) => group.rules.length);
  }, [projectionRules, rules]);
  const expandableKeys = useMemo(() => groups.filter((group) => group.rules.length > 1).map((group) => group.key), [groups]);
  const effectiveExpandedGroups = useMemo(() => {
    const next = new Set(expandedGroups);
    if (transientExpandedKey) next.add(transientExpandedKey);
    return next;
  }, [expandedGroups, transientExpandedKey]);
  const allExpanded = expandableKeys.length > 0 && expandableKeys.every((key) => effectiveExpandedGroups.has(key));
  const appliedCount = state?.active ? analysis.count : 0;
  const hasExportableRules = exportableRules(rules).length > 0;

  useEffect(() => {
    setExpandedGroups((current) => {
      const valid = new Set(expandableKeys);
      const next = new Set([...current].filter((key) => valid.has(key)));
      return next.size === current.size ? current : next;
    });
    setTransientExpandedKey((current) => current && !expandableKeys.includes(current) ? null : current);
  }, [expandableKeys]);

  if (!state) {
    return <main className="page"><section className="extension loading" aria-label={tr("loadingLabel")}>{tr("loading")}</section></main>;
  }

  const updateRule = (nextRule, changeType) => {
    const current = stateRef.current.rules;
    const next = replaceHeaderRule(current, nextRule);
    if (changeType === "value") return commitRules(next, { projection: "preserve", transient: "preserve" });
    if (changeType === "enabled") return commitRules(next, { projection: "immediate", transient: "clear" });

    const snapshot = captureFocusedInput();
    const disabledDuplicate = current.some((rule) => rule.id !== nextRule.id && rule.enabled && !next.find((candidate) => candidate.id === rule.id)?.enabled);
    return commitRules(next, {
      projection: disabledDuplicate ? "immediate" : "deferred",
      transient: "derive",
      snapshot
    });
  };
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
    setTransientExpandedKey(null);
    setLocale(next);
    persistLanguage(next).catch(() => showToast("saveFailed", undefined, "error"));
  };

  const setGroupExpanded = (key, expanded) => {
    setTransientExpandedKey(null);
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (expanded) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAllGroups = () => {
    if (!expandableKeys.length) return;
    setTransientExpandedKey(null);
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
              <button className="language-toggle" type="button" lang={locale === "zh-CN" ? "en" : "zh-CN"} aria-label={tr("switchLanguage")} title={tr("switchLanguage")} onClick={toggleLanguage}><span aria-hidden="true">{locale === "zh-CN" ? "En" : "Zh"}</span></button>
              <button className="group-view-button" type="button" disabled={!expandableKeys.length} aria-expanded={allExpanded} title={expandableKeys.length ? tr(allExpanded ? "collapseAll" : "expandAll") : tr("noExpandableGroups")} onClick={toggleAllGroups}>{tr(allExpanded ? "collapseAll" : "expandAll")}</button>
              <span className="rule-count" title={tr("appliedCountTitle", appliedCount)}>{tr("appliedCount", appliedCount)}</span>
              <button className="switch" type="button" role="switch" aria-checked={state.active} aria-label={tr("enableAll")} title={tr("masterSwitch")} onClick={() => commitState((current) => ({ ...current, active: !current.active }))} />
            </div>
          </header>

          <section className="rules-panel">
            {rules.length ? (
              <RuleList
                rules={projectedRules}
                groups={groups}
                analysis={analysis}
                expandedGroups={effectiveExpandedGroups}
                focusRuleId={focusRuleId}
                selected={selected}
                recentlyMoved={recentlyMoved}
                tr={tr}
                onUpdate={updateRule}
                onRemove={removeRule}
                onDuplicate={duplicate}
                onDeleteGroup={removeGroup}
                onSetGroupExpanded={setGroupExpanded}
                onSelect={setSelected}
                onMove={move}
              />
            ) : <div className="empty-state is-visible" role="status">{tr("emptyState")}</div>}
          </section>

          <footer className="footer">
            <div className="footer-actions">
              <button className="add-button" type="button" aria-label={tr("addRule")} title={tr("addRuleTitle")} onClick={addRule}><AddIcon /></button>
              <button className="footer-icon-button" type="button" aria-label={tr("importHeaders")} title={tr("importHeaders")} onClick={() => setImportOpen(true)}><ImportIcon /></button>
              <button className="footer-icon-button" type="button" disabled={!hasExportableRules} aria-label={tr(hasExportableRules ? "chooseExportHeaders" : "noExportableHeaders")} title={tr(hasExportableRules ? "exportHeaders" : "noExportableHeaders")} onClick={() => setExportOpen(true)}><ExportIcon /></button>
            </div>
          </footer>
        </section>
      </main>

      <ImportDialog open={importOpen} tr={tr} onClose={() => setImportOpen(false)} onImport={importRules} />
      <ExportDialog open={exportOpen} rules={rules} tr={tr} onClose={() => setExportOpen(false)} onSuccess={(count) => showToast("copiedCount", { count })} />
      <div className="sr-only" role="status" aria-live="polite">{moveAnnouncement}</div>
      <div className={`toast${toast ? " is-visible" : ""}`} data-tone={toast?.type === "error" ? "error" : "success"} role={toast?.type === "error" ? "alert" : "status"} aria-live={toast?.type === "error" ? "assertive" : "polite"}>{toast ? tr(toast.key, toast.values) : ""}</div>
    </>
  );
}
