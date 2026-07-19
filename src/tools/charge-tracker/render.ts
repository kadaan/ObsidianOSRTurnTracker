import { App, Notice } from "obsidian";
import { fenceBlock } from "../../core/block";
import { RenderContext } from "../../core/tool";
import { ConfirmModal } from "../../ui/confirm-modal";
import { appendHotkeyHint } from "../../ui/hotkey-hint";
import { iconChip } from "../../ui/icon-chip";
import { inlineEdit } from "../../ui/inline-edit";
import { openMenu } from "../../ui/menu";
import { progressBar } from "../../ui/progress-bar";
import {
  addItem,
  decrementCharge,
  incrementCharge,
  removeItem,
  renameItem,
  setCharge,
  setMax,
} from "./actions";
import { serializeChargeState } from "./codec";
import { chargeCommandIds } from "./commands";
import { CHARGE_LANG, ChargeTrackerState } from "./model";
import { AddChargeItemModal } from "./modal";
import { ChargeRow, computeChargePanel } from "./panel";

/** Commit a numeric inline edit through `mutate` when the input is a non-empty whole number. Blank
 *  is ignored — Number("") is 0, which would silently zero the value (esp. max). */
const numericEdit =
  (mutate: (value: number) => void) =>
  (value: string): void => {
    if (value.trim() === "") return;
    const next = Number(value);
    if (Number.isInteger(next)) mutate(next);
  };

/** Render the charge-tracker widget: an Add button + one row (name · bar · count · − · + · trash)
 *  per item, styled to match the turn tracker's effect rows. `app` opens the add-item modal. */
export function renderChargeTracker(ctx: RenderContext<ChargeTrackerState>, app: App): void {
  const root = ctx.container.createDiv({ cls: "osr-charge" });
  const openAdd = (): void =>
    new AddChargeItemModal(app, (item) => ctx.mutate(addItem(item))).open();

  // Copy the block, ready to paste into another note (like the turn tracker's Copy tracker state).
  const copyData = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(fenceBlock(CHARGE_LANG, serializeChargeState(ctx.state)));
      new Notice("Charge tracker data copied to clipboard.");
    } catch {
      new Notice("OSR Tools: couldn't access the clipboard.");
    }
  };

  // Header: title on the left, Add item pushed to the far right; right-click for widget-level actions.
  const header = root.createDiv({ cls: "osr-charge-header" });
  header.createSpan({ cls: "osr-charge-title", text: "Charge Tracker" });
  const addButton = header.createEl("button", { cls: "osr-charge-add" });
  // Quietly show the Add-item command's hotkey (when the user has assigned one), like the turn tracker.
  appendHotkeyHint(addButton, "Add item…", ctx.hotkeyLabel(chargeCommandIds.addItem));
  addButton.addEventListener("click", openAdd);
  header.addEventListener("contextmenu", (evt) => {
    if ((evt.target as HTMLElement).closest("button")) return; // leave the Add item button alone
    evt.preventDefault();
    evt.stopPropagation();
    openMenu(evt, [{ title: "Copy state", icon: "copy", onClick: () => void copyData() }]);
  });

  if (ctx.state.items.length === 0) {
    root.createDiv({ cls: "osr-charge-empty", text: "No items yet — use “Add item…”." });
    return;
  }

  // Render one item row — name · bar · count · − · + · trash — into `container`.
  const renderRow = (container: HTMLElement, { item, index }: ChargeRow): void => {
    const confirmRemove = (): void =>
      new ConfirmModal(app, `Remove "${item.name}"?`, () => ctx.mutate(removeItem(index))).open();

    const row = container.createDiv({ cls: "osr-charge-row" });
    row.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      openMenu(evt, [
        { title: "Add item…", icon: "plus", onClick: openAdd },
        { title: `Remove ${item.name}`, icon: "trash", onClick: confirmRemove },
      ]);
    });

    // Name (the title): click to rename inline. A blank name is ignored so an item keeps its label.
    const name = row.createSpan({ cls: "osr-charge-name", text: item.name });
    inlineEdit(name, {
      value: item.name,
      cls: "osr-charge-name-input",
      onCommit: (value) => {
        if (value) ctx.mutate(renameItem(index, value));
      },
    });

    // Bar fills the space between the name and the count, like the effect row's progress bar.
    progressBar(row, item.current, item.max);

    // Count: current / max, each click-to-edit (current clamps to max; a lowered max pulls current down).
    const count = row.createDiv({ cls: "osr-charge-count" });
    const current = count.createSpan({ cls: "osr-charge-current", text: String(item.current) });
    inlineEdit(current, {
      value: String(item.current),
      cls: "osr-charge-count-input",
      type: "number",
      onCommit: numericEdit((next) => ctx.mutate(setCharge(index, next))),
    });
    count.createSpan({ cls: "osr-charge-sep", text: "/" });
    const max = count.createSpan({ cls: "osr-charge-max", text: String(item.max) });
    inlineEdit(max, {
      value: String(item.max),
      cls: "osr-charge-count-input",
      type: "number",
      onCommit: numericEdit((next) => ctx.mutate(setMax(index, next))),
    });

    iconChip(row, "minus", `Spend a charge from ${item.name}`, "osr-charge-btn", () =>
      ctx.mutate(decrementCharge(index)),
    );
    iconChip(row, "plus", `Restore a charge to ${item.name}`, "osr-charge-btn", () =>
      ctx.mutate(incrementCharge(index)),
    );
    iconChip(row, "trash", `Remove ${item.name}`, "osr-charge-delete", confirmRemove);
  };

  // Items with charges left render directly; spent ones drop into a collapsed, dimmed
  // "Exhausted" section — the charge tracker's equivalent of the turn tracker's Expired list.
  const { available, exhausted } = computeChargePanel(ctx.state);
  available.forEach((row) => renderRow(root, row));

  if (exhausted.length > 0) {
    const section = root.createEl("details", { cls: "osr-charge-exhausted" });
    section.createEl("summary", {
      cls: "osr-charge-exhausted-title",
      text: `Exhausted (${exhausted.length})`,
    });
    exhausted.forEach((row) => renderRow(section, row));
  }
}
