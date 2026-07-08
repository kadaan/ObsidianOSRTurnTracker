/** The outcome of evaluating a duration expression. */
export interface DurationRoll {
  /** Final turn count (dice summed plus the modifier). May be ≤ 0 for a big negative modifier. */
  total: number;
  /** True when the expression rolled dice (vs a plain number). */
  rolled: boolean;
  /** Canonical form ("2d6+1", "6") — used as the history key and shown in the roll message. */
  expr: string;
}

/** Upper bound on dice rolled at once, guarding against a pathological count like `9999d6`. */
const MAX_DICE = 100;

const DICE_RE = /^(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?$/i;

/** A parsed duration expression: a flat number, or dice with a flat modifier. */
type ParsedDuration =
  | { dice: false; value: number }
  | { dice: true; count: number; sides: number; modifier: number };

/**
 * Parse a duration expression: a plain whole number (`"6"`) or dice notation — `XdY`, `dY`,
 * `XdY+Z`, `XdY-Z` (e.g. `"2d6+1"`). Whitespace is ignored. Returns undefined for anything
 * unparseable or an out-of-range dice count.
 */
function parseDuration(input: string): ParsedDuration | undefined {
  const text = input.trim();
  if (/^\d+$/.test(text)) return { dice: false, value: Number(text) };

  const m = DICE_RE.exec(text);
  if (!m) return undefined;
  const count = m[1] === "" ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  if (count < 1 || count > MAX_DICE || sides < 1) return undefined;
  const modifier = m[3] ? Number(m[3].replace(/\s+/g, "")) : 0;
  return { dice: true, count, sides, modifier };
}

/**
 * Whether `input` is a usable duration expression — a whole number ≥ 1, or dice notation. Does not
 * roll (safe for per-keystroke validation). A dice expression is "valid" here even if a given roll
 * could come out ≤ 0; the caller checks the actual rolled total.
 */
export function isValidDuration(input: string): boolean {
  const p = parseDuration(input);
  if (!p) return false;
  return p.dice || p.value >= 1;
}

/** Canonical text for a parsed expression, so equivalent inputs ("2d6 + 1", "06") share a key. */
function canonical(p: ParsedDuration): string {
  if (!p.dice) return String(p.value);
  const mod = p.modifier === 0 ? "" : p.modifier > 0 ? `+${p.modifier}` : String(p.modifier);
  return `${p.count}d${p.sides}${mod}`;
}

/**
 * Default randomness: a crypto-backed uniform value in [0, 1). Requires `crypto` lazily and guards
 * it, so a platform without Node's `require` (e.g. Obsidian mobile) falls back to `Math.random`
 * instead of throwing at module load. Tests inject their own rng.
 */
const cryptoRng = (): number => {
  try {
    return require("crypto").randomInt(0x1_0000_0000) / 0x1_0000_0000;
  } catch {
    return Math.random();
  }
};

/**
 * Parse and roll a duration expression (see `parseDuration`). Dice are summed with the modifier; a
 * plain number passes through. `rng` yields [0, 1) and is injectable so tests are deterministic.
 * Returns undefined for an unparseable expression.
 */
export function rollDuration(
  input: string,
  rng: () => number = cryptoRng,
): DurationRoll | undefined {
  const p = parseDuration(input);
  if (!p) return undefined;
  if (!p.dice) return { total: p.value, rolled: false, expr: canonical(p) };

  let total = p.modifier;
  for (let i = 0; i < p.count; i++) total += 1 + Math.floor(rng() * p.sides);
  return { total, rolled: true, expr: canonical(p) };
}
