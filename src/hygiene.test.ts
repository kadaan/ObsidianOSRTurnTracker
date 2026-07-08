import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The community store forbids raw HTML injection, dynamic code eval, and network calls. This scans
// the shipped source (everything under src/ except tests) so a regression fails the build.
const srcDir = fileURLToPath(new URL(".", import.meta.url));
const sources = readdirSync(srcDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: "innerHTML", re: /\.innerHTML\b/ },
  { label: "outerHTML", re: /\.outerHTML\b/ },
  { label: "insertAdjacentHTML", re: /insertAdjacentHTML/ },
  { label: "eval", re: /\beval\s*\(/ },
  { label: "new Function", re: /new\s+Function\s*\(/ },
  { label: "fetch", re: /\bfetch\s*\(/ },
  { label: "requestUrl", re: /\brequestUrl\s*\(/ }, // Obsidian's own network call
  { label: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { label: "WebSocket", re: /\bWebSocket\b/ },
  { label: "network module", re: /(?:require\(\s*|import\(\s*|from\s+)['"](?:node:)?(?:http|https|net|dns|tls)['"]/ },
];

/** Drop block and line comments so a forbidden token mentioned in prose can't trip the scan. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("community-store hygiene", () => {
  for (const file of sources) {
    const text = stripComments(readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"));
    it(`${file} uses no forbidden DOM/eval/network APIs`, () => {
      const hits = FORBIDDEN.filter(({ re }) => re.test(text)).map(({ label }) => label);
      expect(hits).toEqual([]);
    });
  }
});
