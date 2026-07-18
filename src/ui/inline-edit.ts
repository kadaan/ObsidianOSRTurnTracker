/**
 * Turn a display element into a click-to-edit field: clicking swaps it for an input, which commits
 * on Enter/blur (Escape cancels) and calls `onCommit` only when the value actually changed.
 * Returns a `start()` so the edit can also be opened programmatically (e.g. from a menu).
 *
 * Shared UI primitive — used by the turn tracker (marker rename/time edit) and the charge tracker
 * (item rename, charge count).
 */
export function inlineEdit(
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
