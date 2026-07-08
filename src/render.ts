import { Menu, debounce, setIcon } from "obsidian";
import { LightPreset, TrackerState } from "./model";
import { computeGrid, DayNote } from "./grid";
import { computeEffectPanel, EffectPanel, EffectRow } from "./panel";
import { MarkerEvent, MarkerPhase, inSegments, markerEventAt } from "./markers";
import { makeDayHeader, formatSpan } from "./dates";
import { OsrTurnTrackerSettings } from "./settings";

/** How long the cursor must rest on a box before its non-active rows dim (avoids sweep flicker). */
const DIM_HOVER_DELAY_MS = 250;

/** A panel row paired with its active burn segments, used to dim rows on box hover. */
type DimRow = { el: HTMLElement; segments: Array<[number, number]> };

/** An entry in a context or caret menu. */
type MenuItemSpec = { title: string; icon?: string; onClick: () => void };

/** Open a menu of `items` at the event's position. */
function openMenu(evt: MouseEvent, items: MenuItemSpec[]): void {
  const menu = new Menu();
  for (const it of items) {
    menu.addItem((item) => {
      item.setTitle(it.title).onClick(it.onClick);
      if (it.icon) item.setIcon(it.icon);
    });
  }
  menu.showAtMouseEvent(evt);
}

/** Menu item that lights a preset (control bar and box menu; `startsAt` defaults to the current turn). */
const presetItem = (handlers: TrackerHandlers, p: LightPreset, startsAt?: number): MenuItemSpec => ({
  title: p.label,
  onClick: () => handlers.onLight(p.id, p.turns, startsAt),
});

/** Menu item that opens the Custom-effect dialog (`startsAt` defaults to the current turn). */
const customItem = (handlers: TrackerHandlers, startsAt?: number): MenuItemSpec => ({
  title: "Custom…",
  onClick: () => handlers.onAddEffect(startsAt),
});

/** Append a "×" delete chip that runs `onDelete` (stopping propagation so it doesn't also select). */
function deleteChip(parent: HTMLElement, onDelete: () => void): void {
  parent.createSpan({ cls: "osr-tt-chip-x", text: "×" }).addEventListener("click", (evt) => {
    evt.stopPropagation();
    onDelete();
  });
}

/** The turn a box event targets, or undefined if the event isn't over a box. */
const boxTurnFrom = (evt: Event): number | undefined => {
  const boxEl = (evt.target as HTMLElement).closest<HTMLElement>(".osr-tt-box");
  return boxEl?.dataset.turn === undefined ? undefined : Number(boxEl.dataset.turn);
};

export interface TrackerHandlers {
  onEndTurn: () => void;
  onAdvanceHours: (hours: number) => void;
  onBoxClick: (turn: number) => void;
  onLight: (preset: string, turns: number, startsAt?: number) => void;
  onAddEffect: (startsAt?: number) => void;
  onClearExpired: () => void;
  onClearAll: () => void;
  onRemoveMarker: (index: number, label: string) => void;
  onRenameMarker: (index: number, name: string) => void;
  onPause: (index: number) => void;
  onResume: (index: number) => void;
  onSetRemaining: (index: number, turns: number) => void;
  onCopyState: () => void;
  onAddNote: (at?: number) => void;
  onEditNote: (index: number, text: string) => void;
  onDeleteNote: (index: number) => void;
}

/**
 * Turn a display element into a click-to-edit field: clicking swaps it for an input, which commits
 * on Enter/blur (Escape cancels) and calls `onCommit` only when the value actually changed.
 * Returns a `start()` so the edit can also be opened programmatically (e.g. from a menu).
 */
function inlineEdit(
  target: HTMLElement,
  opts: { value: string; cls: string; type?: string; onCommit: (value: string) => void },
): () => void {
  let editing = false;
  const start = () => {
    if (editing) return;
    editing = true;
    const input = createEl("input", { cls: opts.cls });
    input.type = opts.type ?? "text";
    input.value = opts.value;

    let done = false;
    const commit = (save: boolean) => {
      if (done) return;
      done = true;
      editing = false;
      const value = input.value.trim();
      input.replaceWith(target); // restore immediately; a real change re-renders the widget
      if (save && value !== opts.value) opts.onCommit(value);
    };

    input.addEventListener("click", (e) => e.stopPropagation()); // don't toggle the highlight
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit(true);
      else if (e.key === "Escape") commit(false);
    });
    input.addEventListener("blur", () => commit(true));

    target.replaceWith(input);
    input.focus();
    input.select();
  };

  target.addClass("is-editable");
  target.addEventListener("click", (evt) => {
    evt.stopPropagation();
    start();
  });
  return start;
}

/**
 * Render a tracker grid into `container` using Obsidian's DOM helpers (no
 * innerHTML). Thin adapter over the tested `computeGrid`. When `handlers` is
 * given, controls are rendered and grid boxes become clickable (jump-to).
 */
export function renderTracker(
  container: HTMLElement,
  state: TrackerState,
  settings: OsrTurnTrackerSettings,
  handlers?: TrackerHandlers,
  dayHeader?: (dayIndex: number) => string,
  renderMarkdown?: (el: HTMLElement, text: string) => void,
): void {
  container.empty();
  const root = container.createDiv({ cls: "osr-tt" });
  const dayHeaderFn = dayHeader ?? makeDayHeader(state);

  const panel = computeEffectPanel(state, settings.presets);
  // Markers that have started (every phase but upcoming) — the ones whose start/stop/pause/resume
  // transitions are drawn on the grid and named in a box's tooltip.
  const startedRows = [...panel.active, ...panel.paused, ...panel.expired];

  /** Display labels of the rows whose active burn spans `turn`. */
  const spanningLabels = (rows: EffectRow[], turn: number) =>
    rows.filter((r) => inSegments(r.segments, turn)).map((r) => r.label);

  // Tooltip for a box: name each timeline event on this turn (start/stop/pause/resume), then any
  // marker merely active or upcoming here. A marker with an event on this turn isn't also listed
  // under "Active". Lines are newline-separated so each reads on its own row.
  const boxTooltip = (turn: number): string => {
    const events: Record<MarkerEvent, string[]> = { start: [], stop: [], pause: [], resume: [] };
    for (const row of startedRows) {
      const event = markerEventAt(row, turn);
      if (event) events[event].push(row.label);
    }
    const active = spanningLabels(
      panel.active.filter((r) => !markerEventAt(r, turn)),
      turn,
    );
    const upcoming = spanningLabels(panel.upcoming, turn);

    const lines: string[] = [];
    const line = (label: string, names: string[]) => {
      if (names.length) lines.push(`${label}: ${names.join(", ")}`);
    };
    line("Start", events.start);
    line("Stop", events.stop);
    line("Pause", events.pause);
    line("Resume", events.resume);
    line("Active", active);
    line("Upcoming", upcoming);
    return lines.join("\n");
  };

  // Box click → jump to that turn; right-click → add a preset or custom marker starting on it.
  if (handlers) {
    root.addEventListener("click", (evt) => {
      const turn = boxTurnFrom(evt);
      if (turn !== undefined) handlers.onBoxClick(turn);
    });
    root.addEventListener("contextmenu", (evt) => {
      const turn = boxTurnFrom(evt);
      if (turn === undefined) return;
      evt.preventDefault();
      openMenu(evt, [
        ...settings.presets.map((p) => presetItem(handlers, p, turn)),
        customItem(handlers, turn),
        { title: "Note…", icon: "pencil", onClick: () => handlers.onAddNote(turn) },
      ]);
    });
  }

  const grid = computeGrid(state, { lookaheadBuffer: settings.lookaheadBuffer, dayHeader: dayHeaderFn });
  for (const day of grid) {
    // Completed days collapse (click to expand) and dim; the active day stays open.
    const dayEl = root.createEl("details", { cls: "osr-tt-day" });
    dayEl.toggleClass("is-complete", day.complete);
    dayEl.open = !day.complete;

    const headerEl = dayEl.createEl("summary", { cls: "osr-tt-day-header" });
    setIcon(headerEl.createSpan({ cls: "osr-tt-day-chevron" }), "chevron-right");
    headerEl.createSpan({ cls: "osr-tt-day-name", text: day.header });
    if (day.currentTime) {
      headerEl.createSpan({ cls: "osr-tt-day-time", text: day.currentTime });
    }
    if (handlers) {
      // Right-click a day to copy the whole tracker as a code block, to paste into a new note.
      headerEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        openMenu(evt, [{ title: "Copy tracker state", icon: "copy", onClick: () => handlers.onCopyState() }]);
      });
    }

    const hoursEl = dayEl.createDiv({ cls: "osr-tt-hours" });
    for (const hour of day.hours) {
      const row = hoursEl.createDiv({ cls: "osr-tt-hour" });
      row.createSpan({ cls: "osr-tt-hour-label", text: hour.label });
      const boxes = row.createDiv({ cls: "osr-tt-boxes" });
      for (const box of hour.boxes) {
        const cls = ["osr-tt-box", `is-${box.status}`];
        if (handlers) cls.push("is-clickable");
        if (box.spanned) cls.push("in-span");
        if (box.startingCount > 0) cls.push("has-start");
        if (box.endingCount > 0) cls.push("has-ending");
        const boxEl = boxes.createDiv({
          cls: cls.join(" "),
          attr: { "data-turn": box.turn },
          // Count sits inside the fixed-size box (never a sibling) so the grid never shifts;
          // it clears once the ending turn is in the past (the effect is finished).
          text: box.endingCount > 0 && box.status !== "past" ? String(box.endingCount) : "",
        });
        const title = boxTooltip(box.turn);
        if (title) boxEl.setAttribute("title", title);
      }
    }

    renderDayNotes(dayEl, day.notes, handlers, renderMarkdown);
  }

  // The button bar sits directly above the effect panel.
  if (handlers) renderControls(root, handlers, settings);

  const dimRows = renderPanel(root, panel, dayHeaderFn, handlers);

  // Resting on a box dims the panel rows not active on that turn. Debounced so a fast sweep across
  // boxes never dims; cleared only when the cursor leaves the whole tracker (not on box-to-box
  // moves), so it doesn't flicker on and off.
  const dimOnHover = debounce(
    (turn: number) => dimRows.forEach(({ el, segments }) => el.toggleClass("is-dimmed", !inSegments(segments, turn))),
    DIM_HOVER_DELAY_MS,
    true,
  );
  root.addEventListener("mouseover", (evt) => {
    const boxEl = (evt.target as HTMLElement).closest<HTMLElement>(".osr-tt-box");
    if (boxEl) dimOnHover(Number(boxEl.dataset.turn));
    else dimOnHover.cancel(); // moved off the boxes → don't dim for a turn we've left
  });
  root.addEventListener("mouseleave", () => {
    dimOnHover.cancel();
    dimRows.forEach(({ el }) => el.removeClass("is-dimmed"));
  });
}

/** Render a day's notes as a collapsible list: timestamp on the left, click-to-edit, delete. */
function renderDayNotes(
  container: HTMLElement,
  notes: DayNote[],
  handlers?: TrackerHandlers,
  renderMarkdown?: (el: HTMLElement, text: string) => void,
): void {
  if (notes.length === 0) return;
  const el = container.createEl("details", { cls: "osr-tt-notes" });
  el.open = true;
  el.createEl("summary", { cls: "osr-tt-notes-title", text: `Notes (${notes.length})` });

  for (const note of notes) {
    const row = el.createDiv({ cls: "osr-tt-note" });
    row.createSpan({ cls: "osr-tt-note-time", text: note.clock });
    const textEl = row.createDiv({ cls: "osr-tt-note-text" });
    if (renderMarkdown) renderMarkdown(textEl, note.text);
    else textEl.setText(note.text);
    if (!handlers) continue;

    textEl.addClass("is-editable");
    textEl.addEventListener("click", (evt) => {
      // Let links/checkboxes in the rendered markdown work; edit only on clicks elsewhere.
      if ((evt.target as HTMLElement).closest("a, input")) return;
      handlers.onEditNote(note.index, note.text);
    });
    row.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      openMenu(evt, [
        { title: "Edit", icon: "pencil", onClick: () => handlers.onEditNote(note.index, note.text) },
        { title: "Delete", icon: "trash", onClick: () => handlers.onDeleteNote(note.index) },
      ]);
    });
    deleteChip(row, () => handlers.onDeleteNote(note.index));
  }
}

/**
 * Render the Active / Paused / Upcoming / Expired effect lists below the controls, returning each
 * row paired with its burn segments so the caller can wire box-hover dimming.
 */
function renderPanel(
  root: HTMLElement,
  { active, paused, upcoming, expired }: EffectPanel,
  dayHeader: (dayIndex: number) => string,
  handlers?: TrackerHandlers,
): DimRow[] {
  if (active.length + paused.length + upcoming.length + expired.length === 0) return [];

  const dimRows: DimRow[] = [];
  const panelEl = root.createDiv({ cls: "osr-tt-panel" });

  // Click a row to paint its active burn segments on the grid; click again to clear.
  let selected: EffectRow | undefined;
  const applyHighlight = () => {
    root.querySelectorAll<HTMLElement>(".osr-tt-box").forEach((el) => {
      const turn = Number(el.dataset.turn);
      const on = selected !== undefined && inSegments(selected.segments, turn);
      el.toggleClass("is-highlit", on);
    });
  };

  const renderRow = (container: HTMLElement, row: EffectRow, phase: MarkerPhase) => {
    const rowEl = container.createDiv({ cls: "osr-tt-effect" });
    dimRows.push({ el: rowEl, segments: row.segments });
    // A paused marker's span is frozen, so the start→expiry range is misleading — say "Paused".
    const span = phase === "paused" ? "Paused" : formatSpan(row.startsAt, row.expiresAt, dayHeader);
    rowEl.setAttribute("title", `${span} · ${row.remaining} turn(s) left`);

    const nameEl = rowEl.createSpan({ cls: "osr-tt-effect-name", text: row.label });
    if (handlers) {
      // Single-click the name to rename (also reachable from the menu); clicking elsewhere highlights.
      const startRename = inlineEdit(nameEl, {
        value: row.name,
        cls: "osr-tt-effect-name-edit",
        onCommit: (v) => handlers.onRenameMarker(row.index, v),
      });

      rowEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        const items: MenuItemSpec[] = [{ title: "Rename", icon: "pencil", onClick: startRename }];
        if (phase === "active" && row.pausable) {
          items.push({ title: "Pause", icon: "pause", onClick: () => handlers.onPause(row.index) });
        }
        if (phase === "paused") {
          items.push({ title: "Resume", icon: "play", onClick: () => handlers.onResume(row.index) });
        }
        items.push({
          title: "Delete",
          icon: "trash",
          onClick: () => handlers.onRemoveMarker(row.index, row.label),
        });
        openMenu(evt, items);
      });
    }

    const bar = rowEl.createDiv({ cls: "osr-tt-effect-bar" });
    bar.createDiv({ cls: "osr-tt-effect-bar-fill" }).style.width =
      `${Math.round(Math.max(0, Math.min(1, row.progress)) * 100)}%`;

    const timeEl = rowEl.createSpan({ cls: "osr-tt-effect-time", text: `${row.remaining}` });
    if (handlers) {
      // Click the turns-left number to set it — e.g. dialing in durations after adding effects.
      // Not offered for expired markers (they have no remaining duration to adjust).
      if (phase !== "expired") {
        inlineEdit(timeEl, {
          value: `${row.remaining}`,
          type: "number",
          cls: "osr-tt-effect-time-edit",
          onCommit: (v) => {
            // Allow 0 (expires immediately) but not a blank field — Number("") is 0, which would
            // silently expire the marker on an accidental clear-and-blur.
            const turns = Number(v);
            if (v !== "" && Number.isInteger(turns) && turns >= 0) {
              handlers.onSetRemaining(row.index, turns);
            }
          },
        });
      }

      if (phase === "paused") {
        const play = rowEl.createSpan({ cls: "osr-tt-effect-play", attr: { "aria-label": "Resume" } });
        setIcon(play, "play");
        play.addEventListener("click", (evt) => {
          evt.stopPropagation();
          handlers.onResume(row.index);
        });
      }
      deleteChip(rowEl, () => handlers.onRemoveMarker(row.index, row.label));
    }

    rowEl.addEventListener("click", () => {
      selected = selected === row ? undefined : row;
      panelEl.querySelectorAll(".osr-tt-effect.is-selected").forEach((el) => el.removeClass("is-selected"));
      rowEl.toggleClass("is-selected", selected === row);
      applyHighlight();
    });
  };

  const section = (title: string, rows: EffectRow[], phase: MarkerPhase, collapsed: boolean) => {
    if (rows.length === 0) return;
    const cls = `osr-tt-panel-section is-${phase}`;
    if (collapsed) {
      const el = panelEl.createEl("details", { cls });
      el.createEl("summary", { cls: "osr-tt-panel-title", text: `${title} (${rows.length})` });
      rows.forEach((row) => renderRow(el, row, phase));
    } else {
      const el = panelEl.createDiv({ cls });
      el.createDiv({ cls: "osr-tt-panel-title", text: title });
      rows.forEach((row) => renderRow(el, row, phase));
    }
  };

  section("Active", active, "active", false);
  section("Paused", paused, "paused", false);
  section("Upcoming", upcoming, "upcoming", true);
  section("Expired", expired, "expired", true);

  return dimRows;
}

function renderControls(
  root: HTMLElement,
  handlers: TrackerHandlers,
  settings: OsrTurnTrackerSettings,
): void {
  const controls = root.createDiv({ cls: "osr-tt-controls" });
  const addButton = (text: string, onClick: () => void) =>
    controls.createEl("button", { cls: "osr-tt-btn", text }).addEventListener("click", onClick);

  // A primary button joined to a caret that opens `items` as a menu.
  const addSplitButton = (text: string, onClick: () => void, items: MenuItemSpec[]) => {
    const split = controls.createDiv({ cls: "osr-tt-split" });
    split
      .createEl("button", { cls: "osr-tt-btn osr-tt-split-main", text })
      .addEventListener("click", onClick);
    const caret = split.createEl("button", { cls: "osr-tt-btn osr-tt-split-caret", attr: { "aria-label": "More…" } });
    setIcon(caret, "chevron-down");
    caret.addEventListener("click", (evt) => openMenu(evt, items));
  };

  // End Turn is the primary action; the caret advances by whole hours.
  const advances = settings.advanceShortcuts.map((hours) => ({
    title: `Advance ${hours} hour${hours === 1 ? "" : "s"}`,
    onClick: () => handlers.onAdvanceHours(hours),
  }));
  if (advances.length === 0) addButton("End Turn", handlers.onEndTurn);
  else addSplitButton("End Turn", handlers.onEndTurn, advances);

  // Add-marker split button: primary lights the first preset, the caret nests the rest + Custom.
  const custom = customItem(handlers);
  if (settings.presets.length === 0) {
    addButton(custom.title, custom.onClick);
  } else {
    const [firstPreset, ...restPresets] = settings.presets;
    addSplitButton(firstPreset.label, () => handlers.onLight(firstPreset.id, firstPreset.turns), [
      ...restPresets.map((p) => presetItem(handlers, p)),
      custom,
    ]);
  }

  addButton("Note", () => handlers.onAddNote());

  addSplitButton("Clear expired", handlers.onClearExpired, [
    { title: "Clear all", onClick: handlers.onClearAll },
  ]);
}

/** Render a parse/validation error inline, keeping the note responsive. */
export function renderError(container: HTMLElement, message: string): void {
  container.empty();
  container.createDiv({ cls: "osr-tt-error", text: message });
}
