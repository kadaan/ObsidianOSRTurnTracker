/** Command ids for the charge tracker, namespaced under the tool (`osr-tools-charge-tracker:<cmd>`)
 *  so they never collide with other tools' commands. Shared by command registration and the hotkey
 *  hint shown on the widget's Add-item button. */
import { CHARGE_LANG } from "./model";

const ns = (cmd: string): string => `${CHARGE_LANG}:${cmd}`;

export const chargeCommandIds = {
  create: ns("create"),
  addItem: ns("add-item"),
};
