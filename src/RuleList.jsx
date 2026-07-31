import { useEffect, useRef, useState } from "react";
import { projectRuleList } from "./groups.js";
import { CheckIcon, ChevronIcon, CopyIcon, DragIcon, RemoveIcon, StackIcon } from "./icons.jsx";

function DragHandle({ label, payload, onKeyboardMove, onDragStart, onDragEnd, className = "" }) {
  return (
    <button
      className={`drag-handle ${className}`.trim()}
      type="button"
      draggable="true"
      aria-label={label}
      title={label}
      aria-keyshortcuts="ArrowUp ArrowDown"
      onDragStart={(event) => onDragStart(event, payload)}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onKeyboardMove(payload, event.key === "ArrowUp" ? -1 : 1, event.currentTarget);
      }}
    >
      <DragIcon />
    </button>
  );
}

function isGroupToggleSurface(target) {
  if (!target || typeof target.closest !== "function") return false;
  const groupHeader = target.closest(".group-header");
  const collapsedRule = target.closest(".rule.is-group-collapsed");
  if (!groupHeader && !collapsedRule) return false;
  return !target.closest("input, textarea, select, option, .field, [contenteditable='true'], button:not(.drag-handle)");
}

function RuleRow({
  rule,
  issue,
  tr,
  grouped,
  collapsed,
  groupCount,
  expanded,
  shouldFocus,
  selected,
  recentlyMoved,
  payload,
  onChange,
  onRemove,
  onDuplicate,
  onToggleGroup,
  onSelect,
  onKeyboardMove,
  onDragStart,
  onDragEnd,
  onDrop,
  dropClass = "",
  topLevelDragHandlers = null
}) {
  const keyInput = useRef(null);
  const invalid = Boolean(issue);
  const issueMessage = issue ? tr(issue.code, issue.substitutions) : "";
  const errorId = `${rule.id}-error`;

  useEffect(() => {
    if (shouldFocus) keyInput.current?.focus();
  }, [shouldFocus]);

  const dropHandlers = grouped && !collapsed ? {
    onDragOver: (event) => event.preventDefault(),
    onDrop: (event) => onDrop(event, payload)
  } : topLevelDragHandlers || {};

  return (
    <article
      id={`rule-${rule.id}`}
      className={`rule${invalid ? " has-error" : ""}${selected ? " is-selected" : ""}${recentlyMoved ? " is-recently-moved" : ""}${collapsed ? " has-group-header is-group-collapsed" : ""}${dropClass}`}
      data-rule-id={rule.id}
      onPointerDown={() => onSelect(payload)}
      {...dropHandlers}
    >
      <DragHandle
        label={tr(collapsed ? "dragGroup" : "dragItem")}
        payload={payload}
        className={collapsed ? "group-drag" : "rule-drag"}
        onKeyboardMove={onKeyboardMove}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />

      <button
        className="check"
        type="button"
        role="checkbox"
        aria-checked={rule.enabled}
        aria-label={tr("enableRule")}
        onClick={() => onChange({ ...rule, enabled: !rule.enabled }, "enabled")}
      >
        <CheckIcon />
      </button>

      <div className="fields">
        <div className="field">
          <label htmlFor={`${rule.id}-key`}>Key</label>
          <input
            ref={keyInput}
            id={`${rule.id}-key`}
            data-rule-id={rule.id}
            data-field="key"
            className="key-input"
            autoComplete="off"
            spellCheck="false"
            placeholder={tr("headerName")}
            value={rule.key}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(event) => onChange({ ...rule, key: event.target.value }, "key")}
          />
          {invalid && <span id={errorId} className="sr-only">{issueMessage}</span>}
        </div>
        <div className="field">
          <label htmlFor={`${rule.id}-value`}>Value</label>
          <input
            id={`${rule.id}-value`}
            data-rule-id={rule.id}
            data-field="value"
            className="value-input"
            autoComplete="off"
            spellCheck="false"
            placeholder={tr("headerValue")}
            value={rule.value}
            onChange={(event) => onChange({ ...rule, value: event.target.value }, "value")}
          />
        </div>
      </div>

      {collapsed ? (
        <div className="rule-actions group-collapsed-actions">
          <button
            className="group-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls={payload.controlId}
            aria-label={tr("groupSummary", {
              key: rule.key.trim(),
              count: groupCount,
              enabled: rule.enabled ? tr("oneEnabled") : tr("noneEnabled"),
              action: tr("expand")
            })}
            onClick={(event) => {
              event.stopPropagation();
              onToggleGroup();
            }}
          >
            <ChevronIcon />
          </button>
          <span className="group-meta" aria-hidden="true"><span className="group-count" title={tr("groupCount", { count: groupCount })}><StackIcon />{groupCount}</span></span>
        </div>
      ) : (
        <div className="rule-actions">
          <button className="icon-button duplicate" type="button" aria-label={tr("copyRule")} title={tr("copyRule")} onClick={onDuplicate}><CopyIcon /></button>
          <button className="icon-button remove" type="button" aria-label={tr("deleteRule")} title={tr("deleteRuleTitle")} onClick={onRemove}><RemoveIcon /></button>
        </div>
      )}
    </article>
  );
}

export default function RuleList({
  rules,
  groups,
  analysis,
  expandedGroups,
  focusRuleId,
  selected,
  recentlyMoved,
  tr,
  onUpdate,
  onRemove,
  onDuplicate,
  onDeleteGroup,
  onSetGroupExpanded,
  onSelect,
  onMove
}) {
  const [dragging, setDragging] = useState(null);
  const [dropMark, setDropMark] = useState(null);
  const suppressGroupClickUntil = useRef(0);

  const dragStart = (event, payload) => {
    const source = event.currentTarget;
    setDragging(payload);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", payload.type);
    requestAnimationFrame(() => source.closest(".rule, .rule-group")?.classList.add("is-dragging"));
  };
  const dragEnd = (event) => {
    event.currentTarget.closest(".rule, .rule-group")?.classList.remove("is-dragging");
    suppressGroupClickUntil.current = Date.now() + 250;
    setDragging(null);
    setDropMark(null);
  };
  const placement = (event) => event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 ? "before" : "after";
  const drop = (event, target) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragging) onMove(dragging, target, placement(event));
    setDropMark(null);
  };
  const keyboardMove = (payload, direction, handle) => {
    if (onMove(payload, null, direction)) requestAnimationFrame(() => handle.focus());
  };
  const toggleFromSurface = (event, key, expanded) => {
    if (Date.now() < suppressGroupClickUntil.current || !isGroupToggleSurface(event.target)) return;
    onSetGroupExpanded(key, !expanded);
  };
  const projection = projectRuleList(rules, expandedGroups, groups);

  return (
    <div className="rules" id="header-rules-list" aria-live="polite">
      {projection.map((item) => {
        if (item.type === "rule") {
          const { rule } = item;
          const payload = { type: "singleton", ids: [rule.id], key: "", controlId: "" };
          const topSelected = selected?.type !== "member" && selected?.ids?.[0] === rule.id;
          const topMoved = recentlyMoved?.ids?.[0] === rule.id;
          const topDropClass = dropMark?.id === rule.id ? ` drop-${dropMark.placement}` : "";
          return (
            <RuleRow
              key={rule.id}
              rule={rule}
              issue={analysis.issues.get(rule.id)}
              tr={tr}
              grouped={false}
              collapsed={false}
              shouldFocus={focusRuleId === rule.id}
              selected={topSelected}
              recentlyMoved={topMoved}
              payload={payload}
              onChange={onUpdate}
              onRemove={() => onRemove(rule.id)}
              onDuplicate={() => onDuplicate(rule.id)}
              onSelect={onSelect}
              onKeyboardMove={keyboardMove}
              onDragStart={dragStart}
              onDragEnd={dragEnd}
              onDrop={drop}
              dropClass={topDropClass}
              topLevelDragHandlers={{
                onDragOver: (event) => {
                  if (dragging?.type === "member") return;
                  event.preventDefault();
                  setDropMark({ id: payload.ids[0], placement: placement(event) });
                },
                onDrop: (event) => drop(event, payload)
              }}
            />
          );
        }

        const { group } = item;
        const ruleIds = group.rules.map((rule) => rule.id);
        const visible = group.rules.find((rule) => rule.enabled) || group.rules[0];
        const controlId = `group-${group.rules[0].id}`;
        const topPayload = { type: "group", ids: ruleIds, key: group.key, controlId };
        const topSelected = selected?.type !== "member" && selected?.ids?.[0] === topPayload.ids[0];
        const topMoved = recentlyMoved?.ids?.[0] === topPayload.ids[0];
        const topDropClass = dropMark?.id === topPayload.ids[0] ? ` drop-${dropMark.placement}` : "";

        if (item.type === "expanded-group") {
          return (
            <section
              className={`rule-group is-expanded${topSelected ? " is-selected" : ""}${topMoved ? " is-recently-moved" : ""}${topDropClass}`}
              key={group.key}
              data-group-key={group.key}
              onPointerDown={(event) => { if (event.target.closest(".group-header")) onSelect(topPayload); }}
              onClick={(event) => toggleFromSurface(event, group.key, true)}
              onDragOver={(event) => {
                if (dragging?.type === "member") return;
                event.preventDefault();
                setDropMark({ id: topPayload.ids[0], placement: placement(event) });
              }}
              onDrop={(event) => drop(event, topPayload)}
            >
              <header className="group-header">
                <DragHandle label={tr("dragGroup")} payload={topPayload} className="group-drag" onKeyboardMove={keyboardMove} onDragStart={dragStart} onDragEnd={dragEnd} />
                <button className="icon-button group-remove" type="button" aria-label={tr("deleteGroup", { key: visible.key.trim() })} title={tr("deleteEntireGroup")} onClick={() => onDeleteGroup(ruleIds)}><RemoveIcon strokeWidth="1.6" /></button>
                <div className="group-actions">
                  <button
                    className="group-toggle"
                    type="button"
                    aria-expanded="true"
                    aria-controls={controlId}
                    aria-label={tr("groupSummary", {
                      key: visible.key.trim(),
                      count: group.rules.length,
                      enabled: visible.enabled ? tr("oneEnabled") : tr("noneEnabled"),
                      action: tr("collapse")
                    })}
                    onClick={(event) => { event.stopPropagation(); onSetGroupExpanded(group.key, false); }}
                  ><ChevronIcon /></button>
                  <span className="group-meta" aria-hidden="true"><span className="group-count"><StackIcon />{group.rules.length}</span></span>
                </div>
              </header>
              <div className="group-rule-list" id={controlId}>
                {group.rules.map((rule) => {
                  const payload = { type: "member", id: rule.id, ids: [rule.id], key: group.key, controlId };
                  return (
                    <RuleRow
                      key={rule.id}
                      rule={rule}
                      issue={analysis.issues.get(rule.id)}
                      tr={tr}
                      grouped
                      collapsed={false}
                      shouldFocus={focusRuleId === rule.id}
                      selected={selected?.type === "member" && selected.id === rule.id}
                      recentlyMoved={recentlyMoved?.type === "member" && recentlyMoved.id === rule.id}
                      payload={payload}
                      onChange={onUpdate}
                      onRemove={() => onRemove(rule.id)}
                      onDuplicate={() => onDuplicate(rule.id)}
                      onSelect={onSelect}
                      onKeyboardMove={keyboardMove}
                      onDragStart={dragStart}
                      onDragEnd={dragEnd}
                      onDrop={drop}
                    />
                  );
                })}
              </div>
            </section>
          );
        }

        return (
          <section
            className={`rule-group${topSelected ? " is-selected" : ""}${topMoved ? " is-recently-moved" : ""}${topDropClass}`}
            key={group.key}
            data-group-key={group.key}
            onPointerDown={() => onSelect(topPayload)}
            onClick={(event) => toggleFromSurface(event, group.key, false)}
            onDragOver={(event) => {
              if (dragging?.type === "member") return;
              event.preventDefault();
              setDropMark({ id: topPayload.ids[0], placement: placement(event) });
            }}
            onDrop={(event) => drop(event, topPayload)}
          >
            <div className="group-rule-list" id={controlId}>
              <RuleRow
                rule={visible}
                issue={analysis.issues.get(visible.id)}
                tr={tr}
                grouped
                collapsed
                groupCount={group.rules.length}
                expanded={false}
                shouldFocus={focusRuleId === visible.id}
                selected={topSelected}
                recentlyMoved={topMoved}
                payload={topPayload}
                onChange={onUpdate}
                onToggleGroup={() => onSetGroupExpanded(group.key, true)}
                onSelect={onSelect}
                onKeyboardMove={keyboardMove}
                onDragStart={dragStart}
                onDragEnd={dragEnd}
                onDrop={drop}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
