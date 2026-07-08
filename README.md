# OSR Turn Tracker

An Obsidian plugin for running old-school dungeon exploration: track the 10-minute
exploration turn, light sources, and timed effects right inside a note. Everything lives
in a single ` ```turn-tracker ` code block whose YAML is the source of truth — no external
scripts, themes, or JavaScript to enable.

> **Upgrading from the Templater version?** The original Templater / Meta-Bind build is
> preserved at the [`v1.3-legacy`](../../releases/tag/v1.3-legacy) tag. This plugin
> replaces it — you no longer need ITS Theme, Templater, Meta-Bind, or JS Engine.

## Features

- A `turn-tracker` code block that renders an interactive timeline: one box per turn,
  grouped into hour rows (6 turns) and day blocks (144 turns).
- **End Turn** and **advance by hours** (default +1h / +3h / +8h) as buttons and as
  hotkey-able commands.
- **Click any box** to move the elapsed/remaining boundary; jumping backward is allowed and
  reversibly recomputes everything.
- **Lights and effects** in one list, shipping with Torch (6 turns) and Lantern (24)
  presets. Add ad-hoc effects with a label and a duration — a plain number *or dice*, e.g.
  `2d6+1`, rolled when you add it.
- **Pause / resume** pausable markers (the lights) — their burn freezes and the timeline
  reflects the gap.
- **Rename** any marker instance (e.g. "Aragorn's torch"), set its remaining turns inline,
  and remove it. An Active / Paused / Upcoming / Expired panel shows each marker's progress.
- **Notes** anchored to a turn, shown under the day they fall in, with full Markdown.
- **Copy tracker state** from a day's right-click menu to paste a clean continuation into a
  new session note (spent markers and past notes are dropped).
- **Day headers** in three modes: `Day N`, real dates (from a `start` datetime), or a
  fantasy calendar via the optional [Calendarium](https://github.com/javalent/calendarium)
  plugin. Days are collapsible; the current day stays open.
- Configurable presets, advance shortcuts, and look-ahead buffer in the settings tab.

## Installation

### Community plugins

Once accepted into the Obsidian community store: **Settings → Community plugins → Browse**,
search for "OSR Turn Tracker", install, and enable.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](../../releases/latest) into
`<vault>/.obsidian/plugins/osr-turn-tracker/`, then enable the plugin in
**Settings → Community plugins**.

### BRAT

Add this repository in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin to
track pre-release builds.

## Usage

Run the **Insert Turn Tracker** command (or type the block by hand) to drop a tracker:

````markdown
```turn-tracker
position: 0
```
````

When inserted into a note that has a `startTime` and/or `fc-calendar` frontmatter field,
those seed the block's `start` and `calendar`. Then use the widget:

- **End Turn / +Xh** — advance time. The caret next to a button opens the other options.
- **Torch / Lantern / Custom…** — add a marker starting now. "Custom…" prompts for a label
  and a duration (number or dice).
- **Note** — attach a note at the current turn.
- **Click a box** to jump; **right-click a box** to start a marker or note on that exact turn.
- **Right-click a day header → Copy tracker state** to clone the session into a new note.
- In the effect panel, click a marker's name to rename it, click its turns-left number to set
  it, and right-click for Pause / Resume / Delete.

The plugin rewrites the code block in place on each action, so the note always reflects the
current state.

## Calendarium (optional)

If a block has a `calendar` and the Calendarium plugin is installed, day headers render your
fantasy weekday, day, month, and year. If Calendarium is missing, the tracker still works and
falls back to `Day N` with a one-time notice.

## Development

```sh
npm install
npm run build   # type-check + bundle to main.js
npm test        # vitest unit tests
```

The core (parse, serialize, state transforms, grid/panel/marker models, dates) is pure and
unit-tested; `main.ts` and `render.ts` are the thin Obsidian/DOM glue.

## License

MIT
