/**
 * The tool-agnostic contract the plugin host drives. Each tool is a self-contained
 * `ToolModule`: a fence language, a `BlockCodec` (its parse/serialize pair), and a
 * `render` that builds its widget from a `RenderContext`. The host owns persistence
 * (locate → apply → write) and hands each render a single `mutate` bridge.
 */

export type ParseResult<S> = { ok: true; state: S } | { ok: false; error: string };

/** A tool's block schema, as a pure parse/serialize pair. `parse` is total — it never throws. */
export interface BlockCodec<S> {
  parse(source: string): ParseResult<S>;
  serialize(state: S): string;
}

/** What a tool's `render` receives. `mutate` runs the shared write pipeline for this block. */
export interface RenderContext<S, TSettings = unknown> {
  container: HTMLElement;
  state: S;
  settings: TSettings;
  /** Persist a block-local transform: locate the block, parse, transform, serialize, splice, write. */
  mutate(transform: (state: S) => S): void;
  renderMarkdown(el: HTMLElement, text: string): void;
  /** The hotkey a user assigned to `commandId` for this tool (or undefined), for quiet button hints. */
  hotkeyLabel(commandId: string): string | undefined;
  /** True when there is no editable target (reading mode) — the widget renders without controls. */
  readonly: boolean;
}

/** A tool packaged for the host: identity, its codec, its renderer, and an optional post-write hook. */
export interface ToolModule<S, TSettings = unknown> {
  /** Stable id; also the command-namespace prefix (`<id>:<command>`). */
  id: string;
  /** Fenced code-block language this tool renders (usually === id). */
  lang: string;
  displayName: string;
  codec: BlockCodec<S>;
  render(ctx: RenderContext<S, TSettings>): void;
  /** Runs after a successful write, for side effects (e.g. Calendarium day sync). */
  afterWrite?(before: S, after: S): void | Promise<void>;
}
