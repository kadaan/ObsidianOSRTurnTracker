/**
 * Render a horizontal progress bar filled `value / max` into `parent`. Shared UI primitive; the
 * ratio is clamped to [0, 1] and a zero/negative max renders empty (never divides by zero).
 */
export function progressBar(parent: HTMLElement, value: number, max: number): HTMLElement {
  const bar = parent.createDiv({ cls: "osr-progress" });
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  bar.createDiv({ cls: "osr-progress-fill" }).style.width = `${ratio * 100}%`;
  return bar;
}
