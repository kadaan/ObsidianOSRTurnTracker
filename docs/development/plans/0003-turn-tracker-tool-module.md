# Plan: Relocate the Turn Tracker into `tools/turn-tracker/`

> Source: follow-on refactor to plan 0002 (Multi-Tool Plugin Architecture).

> **Scope note**: This is a pure relocation/decomposition refactor — **no behavior
> change**. It finishes what plan 0002 started: the charge tracker already lives behind
> `createChargeTrackerTool(app)` under `tools/charge-tracker/`, while the turn tracker's
> code is still spread across `src/*.ts` and blended into `main.ts`. The end state is a
> self-contained `tools/turn-tracker/` module and a `main.ts` that is purely the host.
> The 198-test suite + `npm run build` are the safety net; both stay green after every
> phase.

## Architectural Decisions

Durable decisions that apply across all phases:

- **Target layout**: everything turn-tracker-specific moves under `tools/turn-tracker/`,
  mirroring `tools/charge-tracker/`. `core/` (obsidian-free infrastructure) and `ui/`
  (shared widget kit) are unchanged.
- **Layering is already clean** and must stay that way: `core/` and `ui/` import nothing
  from the top level; the charge tracker reaches only into `core/`, `ui/`, and `dice`.
  The turn-tracker modules are imported *only* by `main.ts` and each other, so they move
  as a unit.
- **`core/` stays obsidian-free.** Tool modules may import from `obsidian` (the turn
  tracker's `render.ts`/`calendarium.ts` do, exactly as the charge render already does).
- **Tool factory shape**: the turn tracker becomes `createTurnTrackerTool(host)`
  returning a `PluginTool<TrackerState>`, paralleling `createChargeTrackerTool(app)`.
  Because it needs far more from the plugin than the charge tracker, `host` is an
  explicit **`TurnTrackerHost` interface** — the one real design decision here, and the
  same seam the next stateful tool will reuse.
- **Host interface (`TurnTrackerHost`)**: the minimal surface the tool needs from the
  plugin — `app`, its `settings` slice, `saveSettings()`, the shared `applyToFile` write
  funnel, `frontmatterAt(path)`, `hotkeyLabel(id)`, and `registerEditorSuggest(...)`.
  Defined in `main.ts` (or a `core/host.ts`) alongside `PluginTool`/`ToolCommand`.
- **`dice.ts` is shared** (both tools use it) and pure → it moves to `core/dice.ts`.
- **Settings**: `OsrTurnTrackerSettings` is entirely turn-tracker-specific (presets,
  advance shortcuts, look-ahead, the three Calendarium fields) → it moves with the tool.
  The host keeps only the single `PluginSettingTab` shell and delegates its body to a
  tool-contributed `settingsSection(containerEl)` (the `settingsSection` hook deferred in
  plan 0002).
- **Effect history** is turn-tracker state persisted in `data.json`. It moves under the
  tool; the host keeps generic load/save plumbing and the tool owns its slice.
- **Frozen**: no fence-language, CSS-prefix, frontmatter-property, or `data.json` shape
  changes — this refactor is invisible to users and to existing vault content.
- **Tests move with their modules** (`git mv` the `.test.ts` beside each source file);
  import paths update but assertions do not.

---

## Phase 1: Move the pure/tool modules into `tools/turn-tracker/`

**User stories**: As a maintainer, I can find every turn-tracker-only module under
`tools/turn-tracker/`, so the tool reads as a self-contained unit like the charge tracker.

**Blocked by**: none.

### What to build

Relocate the turn-tracker-only modules (used solely by `main.ts` and each other) from
`src/` into `src/tools/turn-tracker/`, with their tests: `model`, `actions`, `apply`
(the `trackerCodec`), `block` (`findTrackerBlockAt`/`OPEN_FENCE`), `calendarium`,
`commands`, `dates`, `grid`, `markers`, `panel`, `parse`, `render`, `seed`, `serialize`,
`settings`. Fix relative imports (`./core/*` → `../../core/*`, `./ui/*` → `../../ui/*`,
`./dice` handled in Phase 2). `main.ts` keeps working by updating its import paths only.

### Acceptance criteria

- [x] All listed modules (and their `.test.ts`) live under `src/tools/turn-tracker/`.
- [x] No turn-tracker module remains at the `src/` top level except `main.ts`.
- [x] `core/` and `ui/` still import nothing from the top level or from `tools/`.
- [x] `main.ts` imports the moved modules from their new paths; nothing else changes.
- [x] `npx tsc --noEmit` clean, tests pass (198 → 214: `hygiene.test.ts` now recurses
      into `core/`/`ui/`/`tools/`, closing a pre-existing scan gap), `npm run build`
      succeeds.

---

## Phase 2: Promote the shared `dice` module into `core/`

**User stories**: As a maintainer, shared pure infrastructure lives in `core/`, so the
turn tracker and charge tracker depend on one canonical `dice` module.

**Blocked by**: Phase 1.

### What to build

Move `src/dice.ts` (and `dice.test.ts`) to `src/core/dice.ts`. Update both importers —
the turn-tracker modal/glue and `tools/charge-tracker/modal.ts` — to `core/dice`.

### Acceptance criteria

- [x] `dice.ts`/`dice.test.ts` live under `src/core/`.
- [x] Both tools import dice from `core/dice`; no top-level `dice.ts` remains.
- [x] `core/` remains obsidian-free.
- [x] `npx tsc --noEmit` clean, tests pass (214, per the recursive hygiene scan from
      Phase 1), `npm run build` succeeds.

---

## Phase 3: Extract the turn-tracker glue out of `main.ts` behind a host interface

**User stories**: As a maintainer, the turn tracker is created by
`createTurnTrackerTool(host)` like the charge tracker, so `main.ts` is purely the host
and the tool owns its own logic, modals, and commands.

**Blocked by**: Phase 1, Phase 2. *(The design gate — the host interface is the one real
decision.)*

### What to build

Define `TurnTrackerHost` (the minimal surface the tool needs from the plugin) and move
the turn-tracker glue currently living on the plugin class / in module scope into
`tools/turn-tracker/`: `createTurnTrackerTool`, `turnTrackerCommands`,
`renderTrackerWidget`, `insertTracker`, `resolveState`, `fillMissing`,
`withResolvedDefaults`, `syncCalendarDay`, `warnCalendar`, `copyState`, the effect-history
subsystem (`recordEffect`/`durationFor`/`effectHistoryView`/`forget*`/
`normalizeEffectHistory`/`EffectStat`), and the modals/suggest (`NoteModal`,
`EffectModal`, `EffectLabelSuggest`, `TrackerSuggest`, `PresetModal`,
`presetIdFromLabel`). `main.ts` keeps the generic host: the `Plugin` shell,
`registerTool`, `applyToFile`, `persistWidgetMutation`, `backfillTransform`,
`locateBlock`, `frontmatterAt`, `isFileBeingEdited`, `hotkeyLabel`, and the
`PluginTool`/`ToolCommand`/`TurnTrackerHost` interface declarations. `onload` calls
`this.registerTool(createTurnTrackerTool(host))`.

### Acceptance criteria

- [x] `TurnTrackerHost` is defined and captures exactly what the tool needs (no wider
      plugin surface leaked in) — 7 members; `hotkeyLabel` dropped (reaches the tool via
      `RenderContext`).
- [x] The turn-tracker glue, modals, and `TrackerSuggest` live under
      `tools/turn-tracker/` (`tool.ts`, `modals.ts`, `suggest.ts`, `effect-history.ts`);
      `main.ts` no longer references `TrackerState` internals directly.
- [x] `main.ts` registers the turn tracker via `createTurnTrackerTool(host)`, symmetric
      with `createChargeTrackerTool(app)`.
- [x] Effect history still persists to the same `data.json` `effectHistory` key
      (unchanged `saveSettings`) and reloads via `normalizeEffectHistory`.
- [x] The write funnel's re-entrancy guard (`applying`) and click-time block location
      (`locateBlock`) are unchanged (still host-owned in `main.ts`).
- [x] `npx tsc --noEmit` clean, tests pass (219: +5 for the new source files under the
      recursive hygiene scan), `npm run build` succeeds. **Manual vault smoke test pending
      user verification** — render, commands, modals, autocomplete, Calendarium sync
      (Obsidian runtime can't be exercised here).

---

## Phase 4: Split the settings tab via a tool-contributed `settingsSection`

**User stories**: As a maintainer, each tool contributes its own settings section, so the
host owns only the settings-tab shell and the turn tracker's settings live with the tool.

**Blocked by**: Phase 3.

### What to build

Add an optional `settingsSection(containerEl)` hook to the tool contract. Move the body
of `OsrSettingsTab.display()` (the "Turn Tracker" parent group: look-ahead, advance
shortcuts, in-game-date property, the Calendarium sub-group, presets, effect history)
into the turn tracker's `settingsSection`. `main.ts` keeps a single `PluginSettingTab`
shell that iterates registered tools and calls each one's `settingsSection`.

### Acceptance criteria

- [ ] The tool contract exposes an optional `settingsSection(containerEl)`.
- [ ] The turn tracker's settings render from its own `settingsSection`; the settings
      pane looks identical (same "Turn Tracker" parent heading + nested group).
- [ ] `main.ts`'s settings tab contains no turn-tracker-specific rows — only the shell
      that delegates to each tool.
- [ ] `npx tsc --noEmit` clean, 198 tests pass, `npm run build` succeeds; manual smoke
      test confirms every settings control still reads/writes and persists.

---

## Sequencing & risk

- Phases 1–2 are low-risk mechanical moves fully covered by the existing tests — do them
  first, committing after each.
- Phase 3 is the substantive work; the `TurnTrackerHost` interface is the only real
  design decision and is worth getting right since the next stateful tool reuses it.
- Phase 4 depends on Phase 3 and unblocks any future tool that needs settings.
- Do the whole thing on its own branch off `main`, with tests + build green (and, for
  Phases 3–4, a manual vault smoke test) before each commit.
