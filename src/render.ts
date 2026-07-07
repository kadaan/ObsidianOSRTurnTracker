import { TrackerState } from "./model";
import { computeGrid } from "./grid";

/**
 * Render a read-only tracker grid into `container` using Obsidian's DOM helpers
 * (no innerHTML). Thin adapter over the tested `computeGrid`.
 */
export function renderTracker(container: HTMLElement, state: TrackerState): void {
  container.empty();
  const root = container.createDiv({ cls: "osr-tt" });

  for (const day of computeGrid(state)) {
    const dayEl = root.createDiv({ cls: "osr-tt-day" });
    dayEl.createDiv({ cls: "osr-tt-day-header", text: day.header });

    for (const hour of day.hours) {
      const row = dayEl.createDiv({ cls: "osr-tt-hour" });
      row.createSpan({ cls: "osr-tt-hour-label", text: hour.label });
      const boxes = row.createDiv({ cls: "osr-tt-boxes" });
      for (const box of hour.boxes) {
        boxes.createDiv({ cls: "osr-tt-box" }).toggleClass("is-ticked", box.ticked);
      }
    }
  }
}

/** Render a parse/validation error inline, keeping the note responsive. */
export function renderError(container: HTMLElement, message: string): void {
  container.empty();
  container.createDiv({ cls: "osr-tt-error", text: message });
}
