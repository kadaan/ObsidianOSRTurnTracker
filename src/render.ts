import { Menu, setIcon } from "obsidian";
import { MarkerKind, TrackerState } from "./model";
import { computeGrid } from "./grid";
import { computeEffectPanel, EffectPanel, EffectRow } from "./panel";
import { makeDayHeader, formatSpan } from "./dates";
import { OsrTurnTrackerSettings } from "./settings";

export interface TrackerHandlers {
  onEndTurn: () => void;
  onAdvanceHours: (hours: number) => void;
  onBoxClick: (turn: number) => void;
  onLight: (preset: string, turns: number) => void;
  onAddEffect: () => void;
  onClearExpired: () => void;
  onClearAll: () => void;
  onRemoveMarker: (kind: MarkerKind, index: number, label: string) => void;
  onRenameMarker: (kind: MarkerKind, index: number, name: string) => void;
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
): void {
  container.empty();
  const root = container.createDiv({ cls: "osr-tt" });
  const dayHeaderFn = dayHeader ?? makeDayHeader(state);

  const panel = computeEffectPanel(state, settings.presets);
  // Effects whose span covers a turn, labelled for that turn's tooltip. Kept split by
  // panel group so a not-yet-started effect reads "Upcoming", not "Active".
  const spanningNames = (rows: EffectRow[], turn: number) =>
    rows.filter((r) => r.startsAt <= turn && turn < r.expiresAt).map((r) => r.label);

  // Box click → jump; box hover → dim list rows not active on that turn.
  if (handlers) {
    root.addEventListener("click", (evt) => {
      const boxEl = (evt.target as HTMLElement).closest<HTMLElement>(".osr-tt-box");
      if (boxEl?.dataset.turn !== undefined) handlers.onBoxClick(Number(boxEl.dataset.turn));
    });
  }
  root.addEventListener("mouseover", (evt) => {
    const boxEl = (evt.target as HTMLElement).closest<HTMLElement>(".osr-tt-box");
    if (!boxEl) return;
    const turn = Number(boxEl.dataset.turn);
    root.querySelectorAll<HTMLElement>(".osr-tt-effect").forEach((rowEl) => {
      const s = Number(rowEl.dataset.start);
      const e = Number(rowEl.dataset.end);
      rowEl.toggleClass("is-dimmed", !(s <= turn && turn < e));
    });
  });
  root.addEventListener("mouseout", (evt) => {
    if (!(evt.target as HTMLElement).closest(".osr-tt-box")) return;
    root.querySelectorAll(".osr-tt-effect.is-dimmed").forEach((el) => el.removeClass("is-dimmed"));
  });

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
        const active = spanningNames(panel.active, box.turn);
        const upcoming = spanningNames(panel.upcoming, box.turn);
        const parts: string[] = [];
        if (active.length) parts.push(`Active: ${active.join(", ")}`);
        if (upcoming.length) parts.push(`Upcoming: ${upcoming.join(", ")}`);
        if (parts.length) boxEl.setAttribute("title", parts.join(" · "));
      }
    }
  }

  // The button bar sits directly above the effect panel.
  if (handlers) renderControls(root, handlers, settings);

  renderPanel(root, panel, dayHeaderFn, handlers);
}

/** Render the Active / Upcoming / Expired effect lists below the controls. */
function renderPanel(
  root: HTMLElement,
  { active, upcoming, expired }: EffectPanel,
  dayHeader: (dayIndex: number) => string,
  handlers?: TrackerHandlers,
): void {
  if (active.length === 0 && upcoming.length === 0 && expired.length === 0) return;

  const panelEl = root.createDiv({ cls: "osr-tt-panel" });

  // Click a row to paint its [startsAt, expiresAt) span on the grid; click again to clear.
  let selected: EffectRow | undefined;
  const applyHighlight = () => {
    root.querySelectorAll<HTMLElement>(".osr-tt-box").forEach((el) => {
      const turn = Number(el.dataset.turn);
      const on = selected !== undefined && turn >= selected.startsAt && turn < selected.expiresAt;
      el.toggleClass("is-highlit", on);
    });
  };

  const renderRow = (container: HTMLElement, row: EffectRow) => {
    const rowEl = container.createDiv({
      cls: "osr-tt-effect",
      attr: { "data-start": row.startsAt, "data-end": row.expiresAt },
    });
    rowEl.setAttribute(
      "title",
      `${formatSpan(row.startsAt, row.expiresAt, dayHeader)} · ${row.remaining} turn(s) left`,
    );

    const nameEl = rowEl.createSpan({ cls: "osr-tt-effect-name", text: row.label });
    if (handlers) {
      // Swap the name span for an inline input to give this instance a custom name
      // (e.g. a specific character's torch). Reused by the name click and the menu.
      let editing = false;
      const startEdit = () => {
        if (editing) return;
        editing = true;
        const input = createEl("input", { cls: "osr-tt-effect-name-edit" });
        input.type = "text";
        input.value = row.name;

        let done = false;
        const commit = (save: boolean) => {
          if (done) return;
          done = true;
          editing = false;
          const value = input.value.trim();
          input.replaceWith(nameEl); // restore immediately; a real change re-renders the widget
          if (save && value !== row.name) {
            handlers.onRenameMarker(row.kind, row.index, value);
          }
        };

        input.addEventListener("click", (e) => e.stopPropagation()); // don't toggle the highlight
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit(true);
          else if (e.key === "Escape") commit(false);
        });
        input.addEventListener("blur", () => commit(true));

        nameEl.replaceWith(input);
        input.focus();
        input.select();
      };

      // Single-click the name to rename (a pencil cursor hints at it); clicking elsewhere highlights.
      nameEl.addClass("is-editable");
      nameEl.addEventListener("click", (evt) => {
        evt.stopPropagation();
        startEdit();
      });

      rowEl.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        menu.addItem((item) => item.setTitle("Rename").setIcon("pencil").onClick(startEdit));
        menu.addItem((item) =>
          item
            .setTitle("Delete")
            .setIcon("trash")
            .onClick(() => handlers.onRemoveMarker(row.kind, row.index, row.label)),
        );
        menu.showAtMouseEvent(evt);
      });
    }

    const bar = rowEl.createDiv({ cls: "osr-tt-effect-bar" });
    bar.createDiv({ cls: "osr-tt-effect-bar-fill" }).style.width =
      `${Math.round(Math.max(0, Math.min(1, row.progress)) * 100)}%`;

    rowEl.createSpan({ cls: "osr-tt-effect-time", text: `${row.remaining}` });

    if (handlers) {
      rowEl.createSpan({ cls: "osr-tt-chip-x", text: "×" }).addEventListener("click", (evt) => {
        evt.stopPropagation(); // don't also toggle the highlight
        handlers.onRemoveMarker(row.kind, row.index, row.label);
      });
    }

    rowEl.addEventListener("click", () => {
      selected = selected === row ? undefined : row;
      panelEl.querySelectorAll(".osr-tt-effect.is-selected").forEach((el) => el.removeClass("is-selected"));
      rowEl.toggleClass("is-selected", selected === row);
      applyHighlight();
    });
  };

  const section = (title: string, rows: EffectRow[], collapsed: boolean) => {
    if (rows.length === 0) return;
    if (collapsed) {
      const el = panelEl.createEl("details", { cls: "osr-tt-panel-section" });
      el.createEl("summary", { cls: "osr-tt-panel-title", text: `${title} (${rows.length})` });
      rows.forEach((row) => renderRow(el, row));
    } else {
      const el = panelEl.createDiv({ cls: "osr-tt-panel-section" });
      el.createDiv({ cls: "osr-tt-panel-title", text: title });
      rows.forEach((row) => renderRow(el, row));
    }
  };

  section("Active effects", active, false);
  section("Upcoming", upcoming, true);
  section("Expired", expired, true);
}

function renderControls(
  root: HTMLElement,
  handlers: TrackerHandlers,
  settings: OsrTurnTrackerSettings,
): void {
  const controls = root.createDiv({ cls: "osr-tt-controls" });
  const addButton = (text: string, onClick: () => void) =>
    controls.createEl("button", { cls: "osr-tt-btn", text }).addEventListener("click", onClick);

  addButton("⏩ End Turn", handlers.onEndTurn);
  for (const hours of settings.advanceShortcuts) {
    addButton(`+${hours}h`, () => handlers.onAdvanceHours(hours));
  }
  for (const preset of settings.presets) {
    addButton(preset.label, () => handlers.onLight(preset.id, preset.turns));
  }
  addButton("+ Effect", handlers.onAddEffect);
  addButton("Clear expired", handlers.onClearExpired);
  addButton("Clear all", handlers.onClearAll);
}

/** Render a parse/validation error inline, keeping the note responsive. */
export function renderError(container: HTMLElement, message: string): void {
  container.empty();
  container.createDiv({ cls: "osr-tt-error", text: message });
}
