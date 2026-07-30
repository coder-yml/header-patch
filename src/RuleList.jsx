import { useEffect, useRef, useState } from "react";
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
  onEditing,
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
        onClick={() => onChange({ ...rule, enabled: !rule.enabled }, false)}
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
            onFocus={() => onEditing(rule.id)}
            onBlur={() => onEditing(null)}
            onChange={(event) => onChange({ ...rule, key: event.target.value }, true)}
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
            onFocus={() => onEditing(rule.id)}
            onBlur={() => onEditing(null)}
            onChange={(event) => onChange({ ...rule, value: event.target.value }, false)}
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
            onClick={onToggleGroup}
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
  groups,
  analysis,
  expandedGroups,
  editingRuleId,
  focusRuleId,
  selected,
  recentlyMoved,
  tr,
  onUpdate,
  onRemove,
  onDuplicate,
  onDeleteGroup,
  onToggleGroup,
  onEditing,
  onSelect,
  onMove
}) {
  const [dragging, setDragging] = useState(null);
  const [dropMark, setDropMark] = useState(null);

  const dragStart = (event, payload) => {
    setDragging(payload);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", payload.type);
    requestAnimationFrame(() => event.currentTarget.closest(".rule, .rule-group")?.classList.add("is-dragging"));
  };
  const dragEnd = (event) => {
    event.currentTarget.closest(".rule, .rule-group")?.classList.remove("is-dragging");
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

  return (
    <div className="rules" aria-live="polite">
      {groups.map((group) => {
        const isGroup = group.rules.length > 1;
        const ruleIds = group.rules.map((rule) => rule.id);
        const visible = group.rules.find((rule) => rule.enabled) || group.rules[0];
        const controlId = `group-${group.rules[0].id}`;
        const topPayload = { type: isGroup ? "group" : "singleton", ids: ruleIds, key: group.key, controlId };
        const forceExpanded = editingRuleId && editingRuleId !== visible.id && group.rules.some((rule) => rule.id === editingRuleId);
        const expanded = isGroup && (expandedGroups.has(group.key) || forceExpanded);
        const topSelected = selected?.type !== "member" && selected?.ids?.[0] === topPayload.ids[0];
        const topMoved = recentlyMoved?.ids?.[0] === topPayload.ids[0];
        const topDropClass = dropMark?.id === topPayload.ids[0] ? ` drop-${dropMark.placement}` : "";

        if (!isGroup) {
          const payload = topPayload;
          return (
            <RuleRow
              key={group.rules[0].id}
              rule={group.rules[0]}
              issue={analysis.issues.get(group.rules[0].id)}
              tr={tr}
              grouped={false}
              collapsed={false}
              shouldFocus={focusRuleId === group.rules[0].id}
              selected={topSelected}
              recentlyMoved={topMoved}
              payload={payload}
              onChange={onUpdate}
              onRemove={() => onRemove(group.rules[0].id)}
              onDuplicate={() => onDuplicate(group.rules[0].id)}
              onEditing={onEditing}
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

        return (
          <section
            className={`rule-group${expanded ? " is-expanded" : ""}${topSelected ? " is-selected" : ""}${topMoved ? " is-recently-moved" : ""}${topDropClass}`}
            key={group.key}
            data-group-key={group.key}
            onPointerDown={() => onSelect(topPayload)}
            onDragOver={(event) => {
              if (dragging?.type === "member") return;
              event.preventDefault();
              setDropMark({ id: topPayload.ids[0], placement: placement(event) });
            }}
            onDrop={(event) => drop(event, topPayload)}
          >
            {expanded && (
              <header className="group-header" onClick={(event) => {
                if (!event.target.closest("button")) onToggleGroup(group.key);
              }}>
                <DragHandle label={tr("dragGroup")} payload={topPayload} className="group-drag" onKeyboardMove={keyboardMove} onDragStart={dragStart} onDragEnd={dragEnd} />
                <button className="icon-button group-remove" type="button" aria-label={tr("deleteGroup", { key: visible.key.trim() })} title={tr("deleteEntireGroup")} onClick={() => onDeleteGroup(ruleIds)}><RemoveIcon strokeWidth="1.6" /></button>
                <div className="group-actions">
                  <button className="group-toggle" type="button" aria-expanded="true" aria-controls={controlId} onClick={() => onToggleGroup(group.key)}><ChevronIcon /></button>
                  <span className="group-meta" aria-hidden="true"><span className="group-count"><StackIcon />{group.rules.length}</span></span>
                </div>
              </header>
            )}
            <div className="group-rule-list" id={controlId}>
              {expanded ? group.rules.map((rule) => {
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
                    onEditing={onEditing}
                    onSelect={onSelect}
                    onKeyboardMove={keyboardMove}
                    onDragStart={dragStart}
                    onDragEnd={dragEnd}
                    onDrop={drop}
                  />
                );
              }) : (
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
                  onToggleGroup={() => onToggleGroup(group.key)}
                  onEditing={onEditing}
                  onSelect={onSelect}
                  onKeyboardMove={keyboardMove}
                  onDragStart={dragStart}
                  onDragEnd={dragEnd}
                  onDrop={drop}
                />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
