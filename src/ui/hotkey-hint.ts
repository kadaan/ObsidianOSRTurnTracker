/** Fill a button with its label and, when a hotkey is assigned, a quiet trailing hint plus an
 *  accessible label (so screen readers announce the shortcut). Shared by the tools' widget buttons. */
export function appendHotkeyHint(button: HTMLElement, label: string, hint: string | undefined): void {
  button.createSpan({ text: label });
  if (!hint) return;
  button.createSpan({ cls: "osr-hotkey", text: hint });
  button.setAttribute("aria-label", `${label} (${hint})`);
}
