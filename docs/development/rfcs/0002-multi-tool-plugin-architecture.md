# RFC: Restructure the Plugin to Host Multiple OSR Tools

## Problem

The plugin ships a single tool — the turn tracker — but the codebase is built as
if that tool *is* the plugin. There is exactly one code-block processor
(`main.ts:146`, on `TRACKER_LANG`), and every layer beneath it is hardwired to the
turn tracker's schema:

- `block.ts:17` bakes `turn-tracker` into the fence-matching regex.
- `apply.ts` imports the concrete `parseTrackerState` / `serializeTrackerState`.
- `applyToFile` (`main.ts:501`) — the single disk-write funnel — carries a
  turn-tracker-specific Calendarium side effect inline (`main.ts:517`).
- The settings tab (`main.ts:1062`) and the command set (`main.ts:214`) know only
  about turn-tracker concepts.

We now want to add more tools that render as their own interactive code blocks:

1. A **charge tracker** for long-lived items (wands, staves) — a named row with a
   progress bar, a clickable charge count, and ± buttons.
2. An **XP tracker/calculator** — per-session loot, monster XP, and 3d6-drop-lowest
   Feats of Exploration, dividing XP and gp across a roster of PCs and retainers.

Bolting a second and third tool onto the current structure means either copy-pasting
the whole find-parse-transform-serialize-splice-write pipeline per tool, or threading
tool-specific branches through shared code. Both rot fast. The status quo is
unacceptable because the persistence machinery — which is already generic in spirit —
is trapped behind a turn-tracker-shaped interface, so every new tool pays the full
cost of infrastructure that already exists.

The good news: the write pipeline is *structurally* tool-agnostic already
(`applyTrackerAction` is a pure parse → transform → serialize → splice; the splice,
the re-entrancy guard, and `getSectionInfo`-based block location have zero domain
knowledge). This is a refactor to expose that generality, not a rewrite.

## Decisions

| # | Decision |
|---|----------|
| 1 | The plugin is renamed **OSR Tools** (id `osr-tools`); the turn tracker becomes *one tool among several*. The `turn-tracker` fence language, the `osr-tt-` CSS prefix, and the `osrtt-ingame-date` property are unchanged — existing user notes, styling, and settings keep working. |
| 2 | Introduce a **`ToolModule` interface**. Each tool is a self-contained module declaring its fence language, a `codec` (parse/serialize), a `render` function, and optional commands, settings section, and post-write hook. `main.ts` becomes a thin host that iterates a `TOOLS` array. |
| 3 | **All tools are block-local and self-contained.** Every tool's entire state lives in its own code block and is persisted through the one shared write funnel. The plugin gains *no* new campaign-wide/shared-state model. |
| 4 | The XP tracker's roster is **carried forward per block**, not stored globally. Each `xp-tracker` block embeds its roster snapshot; a **Copy forward** button seeds the next session's block with XP/levels advanced — a direct generalization of the turn tracker's existing `copyState` (`main.ts:535`). |
| 5 | Rendering is mediated by a generic **`RenderContext<S>`** carrying `state`, the tool's `settings` slice, and a single `mutate(t: (s: S) => S)` bridge that runs the shared write pipeline. This replaces the turn tracker's flat 17-callback `TrackerHandlers` (which is rebuilt internally from `mutate`, unchanged in behavior). |
| 6 | Extract two new top-level areas: **`core/`** (tool-agnostic host infrastructure) and **`ui/`** (a shared widget kit: progress bar, inline-rename, stepper row, menu, modal, copy-forward). The progress-bar + inline-edit primitives already exist inside `render.ts` and are lifted out. |
| 7 | Each tool lives under **`tools/<id>/`** and exports one `ToolModule`. The turn tracker is migrated there wholesale with no behavior change; the charge tracker and XP tracker are added as siblings. |
| 8 | The Calendarium day-boundary side effect moves out of `applyToFile` into the turn tracker's `afterWrite` hook, leaving the write funnel tool-neutral. |
| 9 | Settings become **per-tool sections** looped in one tab; commands are **contributed per-tool** and namespaced `<toolId>:<cmd>` by the host. |
| 10 | `dice.ts` is promoted to shared code (both turn-tracker durations and the XP tool's 3d6-drop-lowest Feats roll use it) and gains a "drop lowest" roll. |
| 11 | Incremental, test-green migration: (1) extract `core/`+`ui/` and wrap the turn tracker as the first `ToolModule` — pure refactor, no behavior change; (2) add the charge tracker; (3) add the XP tracker. Each step ships independently. |

## Solution

### The tool module

A tool packages everything the host needs to register and drive it. The host owns
persistence; the tool owns its schema and its UI.

```ts
type ParseResult<S> = { ok: true; state: S } | { ok: false; error: string };

interface ToolModule<S> {
  id: string;                 // "turn-tracker" | "charge-tracker" | "xp-tracker"
  lang: string;               // fence language (usually === id)
  displayName: string;
  codec: {
    parse(source: string): ParseResult<S>;
    serialize(state: S): string;
  };
  render(ctx: RenderContext<S>): void;
  commands?(host: PluginHost): ToolCommand<S>[];  // editor commands this tool adds
  insert?(): string;                              // body for "Insert <tool>"
  settingsSection?(containerEl: HTMLElement, host: PluginHost): void;
  afterWrite?(before: S, after: S, host: PluginHost): void | Promise<void>;
}
```

`main.ts` reduces to a registry loop that does, per tool, exactly what the single
processor does today:

```ts
const TOOLS: ToolModule<unknown>[] = [turnTracker, chargeTracker, xpTracker];

for (const tool of TOOLS) {
  this.registerMarkdownCodeBlockProcessor(tool.lang, (source, el, ctx) => {
    const parsed = tool.codec.parse(source);
    if (!parsed.ok) { renderError(el, parsed.error); return; }
    ctx.addChild(new MarkdownRenderChild(el));
    tool.render({
      container: el,
      state: parsed.state,
      settings: this.settingsFor(tool.id),
      mutate: (t) => void this.mutateFromWidget(el, ctx, tool.codec, t),
      renderMarkdown: (e, txt) => this.renderMarkdown(e, txt),
      hotkeyLabel: (cmd) => this.hotkeyLabel(tool.id, cmd),
      readonly: /* reading mode / no editor */,
    });
  });
}
```

### The render context

`RenderContext<S>` replaces the tool-specific `TrackerHandlers`. A tool builds its
own UI and wires every interaction to `mutate`, which runs the shared pipeline and
lets Obsidian re-render the block from the new YAML (no manual DOM patching for state
changes — the current model).

```ts
interface RenderContext<S> {
  container: HTMLElement;
  state: S;
  settings: unknown;                     // this tool's settings slice
  mutate(transform: (s: S) => S): void;  // locate → parse → transform → serialize → splice → write
  renderMarkdown(el: HTMLElement, text: string): void;
  hotkeyLabel(commandId: string): string | undefined;
  readonly: boolean;                     // no controls when true
}
```

The turn tracker's `TrackerHandlers` object is reconstructed internally from
`ctx.mutate` (each `onXxx` becomes `() => ctx.mutate(actions.xxx(...))`), so
`render.ts` behavior is preserved exactly.

### Generalizing the shared pipeline

Everything below is lifted near-verbatim into `core/`, parameterized only where a
concrete turn-tracker reference exists today.

| Seam (today) | Change |
|--------------|--------|
| `block.ts:17` `OPEN_FENCE` hardcodes `turn-tracker` | `findBlocks(text, lang)` / `findBlockAt(text, line, lang)` take the language |
| `apply.ts:21,26` import concrete parse/serialize | `applyAction(text, range, codec, transform)` — codec injected |
| `applyToFile` Calendarium side effect (`main.ts:517`) | moved to `turnTracker.afterWrite`; the funnel is tool-neutral |
| `block.ts:50` `replaceCodeBlockBody`, re-entrancy guard (`main.ts:507`), `locateBlock` (`getSectionInfo`) | **unchanged** — already generic, moved to `core/` as-is |

### Directory layout

```
src/
  core/
    block.ts          # findBlocks(lang), extract/replaceCodeBlockBody (splice)
    apply.ts          # applyAction(text, range, codec, transform)
    persistence.ts    # applyToFile funnel + re-entrancy guard + locateBlock
    tool.ts           # ToolModule, RenderContext, registry types
  ui/
    progress-bar.ts   # extracted from render.ts renderPanel bar (render.ts:368)
    inline-edit.ts    # extracted from render.ts inlineEdit (render.ts:87)
    stepper.ts        # name + value + ± row  (new; serves charge tracker)
    menu.ts           # openMenu / deleteChip (render.ts:20,46)
    modal.ts          # ConfirmModal (main.ts:709) and modal base
    copy-forward.ts   # generalized from turn tracker copyState (main.ts:535)
  tools/
    turn-tracker/     # model, parse, serialize, actions, render, commands,
                      # settings, calendarium, dates, grid, markers, panel, seed
                      # + index.ts exporting the ToolModule
    charge-tracker/   # model, parse, serialize, actions, render, index
    xp-tracker/       # model, parse, serialize, calc, render, index
  dice.ts             # shared: durations + 3d6-drop-lowest
  settings.ts         # PluginSettings = per-tool slices + shared
  main.ts             # thin host: TOOLS array, register loop, settings tab loop
```

### Tool 1 — Charge tracker

Block-local, self-contained, and mostly assembled from the shared UI kit.

````markdown
```charge-tracker
items:
  - { name: Wand of Fireballs, current: 5, max: 7 }
  - { name: Staff of Healing,  current: 12, max: 25 }
```
````

Each row is a `ui/stepper` (name via `inline-edit`; the count is clickable to set an
exact value; − and + buttons) over a `ui/progress-bar` filled `current / max`. Every
interaction is a one-line `ctx.mutate`. No calendar, no cross-block state.

### Tool 2 — XP tracker

Block-local per session; the roster snapshot is embedded and carried forward.

````markdown
```xp-tracker
session: 12
roster:
  - { name: Gandalf, level: 4, xpAtLevel: 12000 }
  - { name: Sam, level: 2, xpAtLevel: 2000, retainer: true, gpRate: 0.5 }
loot: 3400            # total gp recovered this session
monsters: [ 120, 65, 300 ]   # monster XP awards
feats: [ ]            # Feats of Exploration (3d6 drop lowest) rolls
```
````

- **`calc.ts` (pure):** given the roster and awards, compute each member's share.
  Full shares for PCs; retainers take a **half share of XP always** and a gp share
  scaled by their negotiated `gpRate`. XP totals combine loot-gp (1 gp = 1 XP,
  campaign-configurable), monster XP, and the summed Feats of Exploration.
- **Feats of Exploration:** rolled via the shared `dice.ts` 3d6-drop-lowest helper,
  added to the session pool.
- **Copy forward:** a button (generalized `copy-forward.ts`) that advances each
  member's `xp`/`level`, updates `xpAtLevel` on level-up, increments `session`, and
  emits the next session's fenced block — mirroring how `copyState` prunes and
  re-fences the turn tracker for a clean continuation.

Level thresholds are class-dependent in OSR systems; they live in the XP tool's
settings section (or default to a common table) rather than being hardcoded.

### Settings and commands

`display()` (`main.ts:1070`) loops the tools and calls each `settingsSection`; the
generic row helpers (`propertyText` `main.ts:1297`, `numberInput` `main.ts:1322`) move
to `ui/`. Each tool's `commands(host)` returns its editor commands; the host registers
them namespaced `<toolId>:<cmd>` (today's `commandIds`, `commands.ts:6`, becomes
per-tool). The "Insert &lt;tool&gt;" command uses `tool.insert()`.

## Implementation Recommendations

- **Migration order (each step ships green).**
  1. **Extract `core/` + `ui/` and wrap the turn tracker as the first `ToolModule`.**
     Pure refactor: move code behind the new interface, change no behavior. All
     existing tests (`apply.test.ts`, `block.test.ts`, `serialize.test.ts`,
     `panel.test.ts`, etc.) stay green. This is the risk gate — land it before any
     new tool.
  2. **Charge tracker.** Small; proves the multi-processor host and the shared kit.
  3. **XP tracker.** The domain thinking lives in the pure `calc.ts`; the plumbing is
     free by then.
- **Keep the codec pure and total.** `parse` returns `{ ok, ... }` and never throws
  (mirror `parseTrackerState`, `parse.ts:27`): reject unknown top-level keys, render a
  clear inline error via `renderError` (`render.ts:508`) with the raw block still
  visible. Each tool owns its legacy-migration logic inside its own `parse`.
- **One write funnel, unchanged guarantees.** All tools route through the single
  `applyToFile` with its `applying` re-entrancy guard (`main.ts:507`) and
  click-time `getSectionInfo` location (`locateBlock`, `main.ts:343`) so rapid clicks
  and concurrent edits can't corrupt offsets. Do not add a second write path.
- **Multiple blocks per note, across tools.** Each widget keys off its own section
  range, never a note-wide search — already true for the turn tracker; preserve it for
  every tool.
- **Namespacing.** Prefix CSS per tool where new (`osr-charge-`, `osr-xp-`); leave the
  turn tracker's `osr-tt-` untouched. Namespace commands `<toolId>:<cmd>`.
- **Edge cases.**
  - Malformed/hand-edited YAML in any tool: inline error, never throw.
  - XP tracker with an empty roster or zero awards: render the form, compute zero
    shares, never divide by zero.
  - Copy-forward from a block that is already the latest: it just produces the next
    snapshot; it does not mutate the current block.
- **Do not add** (out of scope per Decisions 3–4): a global/campaign shared-state
  store, a cross-file roster reader, a dedicated roster note or `osr-party` block, or
  any per-tool second write path. All state stays block-local and flows through the
  one funnel.
