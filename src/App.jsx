import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "./i18n.js";
import { analyzeHeaderRules } from "./rules.js";
import { cloneDefaultState, makeRuleId } from "./state.js";
import { loadState, persistState } from "./storage.js";

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m3 8 3 3 7-7" />
  </svg>
);

const RemoveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M6 7h12M9 7V5h6v2M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14" />
  </svg>
);

function RuleRow({ issue, rule, onChange, onRemove, shouldFocus }) {
  const keyInput = useRef(null);
  const invalid = Boolean(issue);
  const issueMessage = issue ? t(issue.code, issue.substitutions) : undefined;

  useEffect(() => {
    if (shouldFocus) keyInput.current?.focus();
  }, [shouldFocus]);

  return (
    <article className={`rule${rule.enabled ? "" : " is-disabled"}${invalid ? " has-error" : ""}`} data-rule-id={rule.id} title={issueMessage}>
      <button
        className="check"
        type="button"
        role="checkbox"
        aria-checked={rule.enabled}
        aria-label={t("enableRule")}
        onClick={() => onChange({ ...rule, enabled: !rule.enabled })}
      >
        <CheckIcon />
      </button>

      <div className="fields">
        <div className="field">
          <label htmlFor={`${rule.id}-key`}>Key</label>
          <input
            ref={keyInput}
            id={`${rule.id}-key`}
            className="key-input"
            autoComplete="off"
            spellCheck="false"
            placeholder={t("headerName")}
            value={rule.key}
            aria-invalid={invalid}
            onChange={(event) => onChange({ ...rule, key: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`${rule.id}-value`}>Value</label>
          <input
            id={`${rule.id}-value`}
            className="value-input"
            autoComplete="off"
            spellCheck="false"
            placeholder={t("headerValue")}
            value={rule.value}
            onChange={(event) => onChange({ ...rule, value: event.target.value })}
          />
        </div>
      </div>

      <button className="icon-button remove" type="button" aria-label={t("deleteRule")} title={t("deleteRuleTitle")} onClick={onRemove}>
        <RemoveIcon />
      </button>
    </article>
  );
}

export default function App() {
  const [state, setState] = useState(null);
  const [toast, setToast] = useState("");
  const [focusRuleId, setFocusRuleId] = useState(null);
  const stateRef = useRef(null);
  const toastTimer = useRef(null);

  const showToast = (message) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  };

  useEffect(() => {
    let disposed = false;

    loadState()
      .catch(() => {
        showToast(t("readFailed"));
        return cloneDefaultState();
      })
      .then((loadedState) => {
        if (disposed) return;
        stateRef.current = loadedState;
        setState(loadedState);
      });

    const flushLatestState = () => {
      if (stateRef.current) persistState(stateRef.current).catch(() => undefined);
    };
    window.addEventListener("pagehide", flushLatestState);

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", flushLatestState);
      window.clearTimeout(toastTimer.current);
    };
  }, []);

  const commitState = (updater) => {
    if (!stateRef.current) return;
    const nextState = typeof updater === "function" ? updater(stateRef.current) : updater;
    stateRef.current = nextState;
    setState(nextState);
    persistState(nextState).catch(() => showToast(t("saveFailed")));
  };

  const currentRules = state?.rules ?? [];
  const currentAnalysis = useMemo(() => analyzeHeaderRules(currentRules), [currentRules]);
  const currentAppliedCount = state?.active ? currentAnalysis.count : 0;

  if (!state) {
    return <main className="page"><section className="extension loading" aria-label={t("loadingLabel")}>{t("loading")}</section></main>;
  }

  const updateCurrentRules = (updater) => {
    commitState((current) => ({
      ...current,
      rules: typeof updater === "function" ? updater(current.rules) : updater
    }));
  };

  const updateRule = (nextRule) => {
    updateCurrentRules((rules) => rules.map((rule) => (rule.id === nextRule.id ? nextRule : rule)));
  };

  const removeRule = (ruleId) => {
    updateCurrentRules((rules) => rules.filter((rule) => rule.id !== ruleId));
    showToast(t("ruleDeleted"));
  };

  const addRule = () => {
    const id = makeRuleId();
    updateCurrentRules((rules) => [...rules, { id, enabled: true, key: "", value: "" }]);
    setFocusRuleId(id);
    showToast(t("ruleAdded"));
  };

  return (
    <>
      <main className="page">
        <section className="extension" aria-label={t("extensionName")}>
          <header className="topbar">
            <div className="brand">
              <div className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 7h16M4 12h10M4 17h16" />
                  <circle cx="17.5" cy="12" r="2.5" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <div className="brand-copy">
                <h1>{t("extensionName")}</h1>
                <p>{t("tagline")}</p>
              </div>
            </div>
            <button
              className="switch"
              type="button"
              role="switch"
              aria-checked={state.active}
              aria-label={t("enableAll")}
              title={t("masterSwitch")}
              onClick={() => {
                const active = !state.active;
                commitState((current) => ({ ...current, active }));
                showToast(t(active ? "allEnabled" : "allPaused"));
              }}
            />
          </header>

          <section>
            <div className="rules-header">
              <div aria-hidden="true" />
              <span
                className="rule-count"
                title={t("appliedCountTitle", currentAppliedCount)}
              >
                {t("appliedCount", currentAppliedCount)}
              </span>
            </div>

            <div className="rules" aria-live="polite">
              {currentRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  issue={currentAnalysis.issues.get(rule.id)}
                  rule={rule}
                  shouldFocus={focusRuleId === rule.id}
                  onChange={updateRule}
                  onRemove={() => removeRule(rule.id)}
                />
              ))}
            </div>
            <div className={`empty-state${currentRules.length === 0 ? " is-visible" : ""}`}>{t("emptyState")}</div>
          </section>

          <footer className="footer">
            <button className="add-button" type="button" aria-label={t("addRule")} title={t("addRuleTitle")} onClick={addRule}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </footer>
        </section>
      </main>

      <div className={`toast${toast ? " is-visible" : ""}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}
