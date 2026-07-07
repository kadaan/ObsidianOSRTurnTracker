import { setIcon } from "obsidian";
import { DEFAULT_ADVANCE_SHORTCUTS, TrackerState } from "./model";
import { computeGrid } from "./grid";

export interface TrackerHandlers {
  onEndTurn: () => void;
  onAdvanceHours: (hours: number) => void;
  onBoxClick: (turn: number) => void;
}

/**
 * Render a tracker grid into `container` using Obsidian's DOM helpers (no
 * innerHTML). Thin adapter over the tested `computeGrid`. When `handlers` is
 * given, controls are rendered and grid boxes become clickable (jump-to).
 */
export function renderTracker(
  container: HTMLElement,
  state: TrackerState,
  handlers?: TrackerHandlers,
): void {
  container.empty();
  const root = container.createDiv({ cls: "osr-tt" });

  if (handlers) {
    renderControls(root, handlers);
    // One delegated listener beats one per box when the grid is large.
    root.addEventListener("click", (evt) => {
      const boxEl = (evt.target as HTMLElement).closest<HTMLElement>(".osr-tt-box");
      if (boxEl?.dataset.turn !== undefined) handlers.onBoxClick(Number(boxEl.dataset.turn));
    });
  }

  for (const day of computeGrid(state)) {
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
        boxes.createDiv({
          cls: `osr-tt-box is-${box.status}${handlers ? " is-clickable" : ""}`,
          attr: handlers ? { "data-turn": box.turn } : undefined,
        });
      }
    }
  }
}

function renderControls(root: HTMLElement, handlers: TrackerHandlers): void {
  const controls = root.createDiv({ cls: "osr-tt-controls" });

  controls
    .createEl("button", { cls: "osr-tt-btn", text: "⏩ End Turn" })
    .addEventListener("click", handlers.onEndTurn);

  for (const hours of DEFAULT_ADVANCE_SHORTCUTS) {
    controls
      .createEl("button", { cls: "osr-tt-btn", text: `+${hours}h` })
      .addEventListener("click", () => handlers.onAdvanceHours(hours));
  }
}

/** Render a parse/validation error inline, keeping the note responsive. */
export function renderError(container: HTMLElement, message: string): void {
  container.empty();
  container.createDiv({ cls: "osr-tt-error", text: message });
}
