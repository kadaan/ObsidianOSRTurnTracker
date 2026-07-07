import { setIcon } from "obsidian";
import { MarkerKind, TrackerState } from "./model";
import { computeGrid } from "./grid";
import { OsrTurnTrackerSettings } from "./settings";

export interface TrackerHandlers {
  onEndTurn: () => void;
  onAdvanceHours: (hours: number) => void;
  onBoxClick: (turn: number) => void;
  onLight: (preset: string, turns: number) => void;
  onAddEffect: () => void;
  onClearExpired: () => void;
  onClearAll: () => void;
  onRemoveMarker: (kind: MarkerKind, key: string, expiresAt: number) => void;
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
): void {
  container.empty();
  const root = container.createDiv({ cls: "osr-tt" });

  if (handlers) {
    renderControls(root, handlers, settings);
    // One delegated listener beats one per box when the grid is large.
    root.addEventListener("click", (evt) => {
      const boxEl = (evt.target as HTMLElement).closest<HTMLElement>(".osr-tt-box");
      if (boxEl?.dataset.turn !== undefined) handlers.onBoxClick(Number(boxEl.dataset.turn));
    });
  }

  const grid = computeGrid(state, {
    presets: settings.presets,
    lookaheadBuffer: settings.lookaheadBuffer,
  });
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
        boxes.createDiv({
          cls: `osr-tt-box is-${box.status}${handlers ? " is-clickable" : ""}`,
          attr: handlers ? { "data-turn": box.turn } : undefined,
        });
        for (const chip of box.markers) {
          const chipEl = boxes.createSpan({ cls: "osr-tt-chip" });
          chipEl.toggleClass("is-expired", chip.expired);
          chipEl.createSpan({ text: chip.count > 1 ? `${chip.label}${chip.count}` : chip.label });
          if (handlers) {
            chipEl
              .createSpan({ cls: "osr-tt-chip-x", text: "×" })
              .addEventListener("click", () =>
                handlers.onRemoveMarker(chip.kind, chip.key, chip.expiresAt),
              );
          }
        }
      }
    }
  }
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
