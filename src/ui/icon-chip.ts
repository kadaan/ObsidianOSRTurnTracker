import { setIcon } from "obsidian";

/**
 * A small clickable icon chip: an icon with an aria-label whose click runs `onClick`, stopping
 * propagation so it doesn't also trigger the surrounding row. Shared by both tools' row controls.
 */
export function iconChip(
  parent: HTMLElement,
  icon: string,
  label: string,
  cls: string,
  onClick: () => void,
): void {
  const chip = parent.createSpan({ cls, attr: { "aria-label": label } });
  setIcon(chip, icon);
  chip.addEventListener("click", (evt) => {
    evt.stopPropagation();
    onClick();
  });
}
