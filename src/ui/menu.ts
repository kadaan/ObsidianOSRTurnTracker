import { Menu } from "obsidian";

/** An entry in a context or caret menu. */
export type MenuItemSpec = { title: string; icon?: string; onClick: () => void };

/** Open a menu of `items` at the event's position. */
export function openMenu(evt: MouseEvent, items: MenuItemSpec[]): void {
  const menu = new Menu();
  for (const it of items) {
    menu.addItem((item) => {
      item.setTitle(it.title).onClick(it.onClick);
      if (it.icon) item.setIcon(it.icon);
    });
  }
  menu.showAtMouseEvent(evt);
}
