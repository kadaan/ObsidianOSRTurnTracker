/** The turn tracker's settings UI: the "Turn Tracker" group (look-ahead, advance shortcuts,
 *  in-game-date property, the Calendarium sub-group, presets, effect history), rendered into the
 *  host's shared settings tab. Bound to the host so the store it edits and persists is the same one
 *  the widget/commands read. */

import { Setting, setIcon, TextComponent } from "obsidian";
import { ConfirmModal } from "../../ui/confirm-modal";
import { isCalendariumAvailable } from "./calendarium";
import { effectHistoryView } from "./effect-history";
import { PresetModal, presetIdFromLabel } from "./modals";
import { LightPreset } from "./model";
import {
  createDefaultSettings,
  DEFAULT_CALENDAR_PROPERTY,
  DEFAULT_START_PROPERTY,
} from "./settings";
import type { TurnTrackerHost } from "./tool";

/** Renders the turn tracker's settings section and re-renders itself in place on each change. */
export class TurnTrackerSettingsSection {
  private section!: HTMLElement;

  constructor(private readonly host: TurnTrackerHost) {}

  /** Build the section into `containerEl`. Owns its own wrapper div so refreshes don't disturb other
   *  tools' sections in the shared tab. */
  render(containerEl: HTMLElement): void {
    this.section = containerEl.createDiv({ cls: "osr-tt-settings" }); // scope for disabled-row styling
    this.renderBody();
  }

  private renderBody(): void {
    this.section.empty();
    const s = this.host.settings;

    // Group the turn tracker's settings under its own heading, nested so the heading reads as their
    // parent (not a sibling of the sub-sections). Other tools' settings sit beside it as we grow.
    new Setting(this.section).setName("Turn Tracker").setHeading();
    const body = this.section.createDiv({ cls: "osr-settings-group" });

    new Setting(body)
      .setName("Look-ahead buffer")
      .setDesc("Turns rendered past the furthest marker.")
      .addText((t) =>
        this.numberInput(t, 0, () => s.lookaheadBuffer, (n) => (s.lookaheadBuffer = n)),
      );

    new Setting(body)
      .setName("Advance shortcuts (hours)")
      .setDesc("Comma-separated. Buttons update live; commands take effect after reload.")
      .addText((t) =>
        t.setValue(s.advanceShortcuts.join(", ")).onChange(async (v) => {
          const hours = v
            .split(",")
            .map((x) => Number(x.trim()))
            .filter((n) => Number.isInteger(n) && n > 0);
          s.advanceShortcuts = [...new Set(hours)];
          await this.host.saveSettings();
        }),
      );

    this.propertyText(body, {
      name: "In-game date property",
      desc: "Note frontmatter property a new tracker reads its in-game start date from.",
      value: s.startProperty,
      fallback: DEFAULT_START_PROPERTY,
      set: (v) => (s.startProperty = v),
    });

    const calendariumAvailable = isCalendariumAvailable();

    new Setting(body).setName("Calendarium").setHeading();
    if (!calendariumAvailable) {
      new Setting(body).setDesc(
        "The Calendarium plugin isn't installed or enabled, so these options are unavailable.",
      );
    }

    this.propertyText(body, {
      name: "Calendar property",
      desc:
        "Note frontmatter property a new tracker reads its calendar name from. " +
        "Falls back to Calendarium's default calendar when unset.",
      value: s.calendarProperty,
      fallback: DEFAULT_CALENDAR_PROPERTY,
      disabled: !calendariumAvailable,
      set: (v) => (s.calendarProperty = v),
    });

    new Setting(body)
      .setName("Sync current date")
      .setDesc(
        "When a turn advances to a new day, set the Calendarium calendar's current date to the tracker's date. Requires a start date.",
      )
      // Row .setDisabled dims + blocks the mouse (via CSS); the control's own .setDisabled also blocks
      // keyboard focus — both are needed for a fully-disabled row.
      .setDisabled(!calendariumAvailable)
      .addToggle((t) =>
        t
          .setValue(s.syncCalendariumDate)
          .setDisabled(!calendariumAvailable)
          .onChange(async (v) => {
            s.syncCalendariumDate = v;
            await this.host.saveSettings();
          }),
      );

    new Setting(body)
      .setName("Presets")
      .setHeading()
      .addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip("Reset to defaults").onClick(() =>
          new ConfirmModal(
            this.host.app,
            "Reset presets to the defaults? Your custom presets will be removed.",
            async () => {
              s.presets = createDefaultSettings().presets;
              await this.host.saveSettings();
              this.renderBody();
            },
            "Reset",
          ).open(),
        ),
      )
      .addExtraButton((b) =>
        b.setIcon("plus").setTooltip("Add preset").onClick(() =>
          this.createPreset({ id: "", label: "New light", turns: "6", pausable: true }),
        ),
      );

    // One standard (responsive) row per preset — name + summary, with reorder / Edit / Delete. The
    // fields are edited in a modal; the first preset is the widget's default (primary) button, so
    // reordering is how the user chooses the default.
    const swapPresets = async (a: number, b: number) => {
      [s.presets[a], s.presets[b]] = [s.presets[b], s.presets[a]];
      await this.host.saveSettings();
      this.renderBody();
    };

    s.presets.forEach((preset, i) => {
      const row = new Setting(body)
        .setName(preset.label || "(unnamed)")
        .setDesc(
          `${preset.turns} turn${preset.turns === "1" ? "" : "s"}` +
            `${preset.pausable ? " · pausable" : ""}${i === 0 ? " · default" : ""}`,
        );

      if (preset.icon) {
        const iconEl = createSpan({ cls: "osr-tt-preset-list-icon" });
        setIcon(iconEl, preset.icon);
        row.nameEl.prepend(iconEl);
      }

      row
        .addExtraButton((b) =>
          b.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(() => swapPresets(i, i - 1)),
        )
        .addExtraButton((b) =>
          b
            .setIcon("arrow-down")
            .setTooltip("Move down")
            .setDisabled(i === s.presets.length - 1)
            .onClick(() => swapPresets(i, i + 1)),
        )
        .addExtraButton((b) =>
          b.setIcon("pencil").setTooltip("Edit").onClick(() =>
            new PresetModal(
              this.host.app,
              "Edit preset",
              preset,
              s.presets.filter((_, j) => j !== i).map((p) => p.label.toLowerCase()),
              async (updated) => {
                s.presets[i] = updated;
                await this.host.saveSettings();
                this.renderBody();
              },
            ).open(),
          ),
        )
        .addExtraButton((b) =>
          b.setIcon("trash").setTooltip("Remove").onClick(() =>
            new ConfirmModal(this.host.app, `Remove the "${preset.label || "unnamed"}" preset?`, async () => {
              s.presets.splice(i, 1);
              await this.host.saveSettings();
              this.renderBody();
            }).open(),
          ),
        );
    });

    const history = effectHistoryView(this.host.effectHistory);

    const historyHeading = new Setting(body)
      .setName("Effect history")
      .setDesc("Custom-effect labels learned for autocomplete and duration pre-fill.")
      .setHeading();
    if (history.length > 0) {
      historyHeading.addExtraButton((b) =>
        b.setIcon("trash").setTooltip("Forget all").onClick(() =>
          new ConfirmModal(this.host.app, "Forget all recorded custom effects?", async () => {
            await this.forgetAllEffects();
            this.renderBody();
          }).open(),
        ),
      );
    }

    if (history.length === 0) {
      new Setting(body).setDesc("No custom effects recorded yet.");
    } else {
      for (const entry of history) {
        const durations = entry.durations
          .map(([expr, count]) => (count > 1 ? `${expr} (×${count})` : expr))
          .join(", ");
        new Setting(body)
          .setName(entry.label)
          .setDesc(`Used ${entry.count}× · ${durations}`)
          .addExtraButton((b) =>
            b.setIcon("list-plus").setTooltip("Promote to preset").onClick(() => {
              // Seed the preset's duration from the effect's most-used expression (dice and all —
              // presets now hold expressions too); the modal lets the user finalize the rest.
              const turns = [...entry.durations].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "6";
              // The effect lives on as a preset, so retire its history entry.
              this.createPreset({ id: "", label: entry.label, turns, pausable: false }, async () => {
                await this.forgetEffect(entry.label);
              });
            }),
          )
          .addExtraButton((b) =>
            b.setIcon("trash").setTooltip("Forget").onClick(() =>
              new ConfirmModal(this.host.app, `Forget the "${entry.label}" effect?`, async () => {
                await this.forgetEffect(entry.label);
                this.renderBody();
              }).open(),
            ),
          );
      }
    }
  }

  /** Forget one recorded custom-effect label; mutates the shared store in place, then persists. */
  private async forgetEffect(label: string): Promise<void> {
    delete this.host.effectHistory[label];
    await this.host.saveSettings();
  }

  /** Forget every recorded custom-effect label. Cleared in place so the tool's shared reference to
   *  the store stays valid. */
  private async forgetAllEffects(): Promise<void> {
    for (const key of Object.keys(this.host.effectHistory)) delete this.host.effectHistory[key];
    await this.host.saveSettings();
  }

  /** Open the preset editor seeded with `seed`, append the result with an id derived from its name,
   *  and refresh. `afterCreate` runs any follow-up (e.g. retiring the promoted effect's history). */
  private createPreset(seed: LightPreset, afterCreate?: () => Promise<void>): void {
    const s = this.host.settings;
    new PresetModal(
      this.host.app,
      "Add preset",
      seed,
      s.presets.map((p) => p.label.toLowerCase()),
      async (created) => {
        created.id = presetIdFromLabel(created.label, s.presets.map((p) => p.id));
        s.presets.push(created);
        await this.host.saveSettings();
        if (afterCreate) await afterCreate();
        this.renderBody();
      },
    ).open();
  }

  /** A settings row for a frontmatter-property name: trims input and restores the default when
   *  cleared. When `disabled`, the row is dimmed/mouse-blocked (row) and keyboard-blocked (control). */
  private propertyText(
    containerEl: HTMLElement,
    opts: {
      name: string;
      desc: string;
      value: string;
      fallback: string;
      disabled?: boolean;
      set: (value: string) => void;
    },
  ): void {
    new Setting(containerEl)
      .setName(opts.name)
      .setDesc(opts.desc)
      .setDisabled(!!opts.disabled)
      .addText((t) =>
        t
          .setPlaceholder(opts.fallback)
          .setValue(opts.value)
          .setDisabled(!!opts.disabled)
          .onChange(async (v) => {
            opts.set(v.trim() || opts.fallback);
            await this.host.saveSettings();
          }),
      );
  }

  /** Wire a text field as a whole-number input (≥ min) that persists valid values. */
  private numberInput(
    t: TextComponent,
    min: number,
    get: () => number,
    set: (n: number) => void,
  ): void {
    t.inputEl.type = "number";
    t.inputEl.min = String(min);
    t.setValue(String(get())).onChange(async (v) => {
      const n = Number(v);
      if (Number.isInteger(n) && n >= min) {
        set(n);
        await this.host.saveSettings();
      }
    });
  }
}
