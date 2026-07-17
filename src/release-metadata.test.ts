import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read a repo-root JSON file (tests live in src/, so root is one level up). */
const readRootJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8"));

const SEMVER = /^\d+\.\d+\.\d+$/;

describe("release metadata", () => {
  const manifest = readRootJson("manifest.json");
  const versions = readRootJson("versions.json");
  const pkg = readRootJson("package.json");

  it("manifest.json carries every field the community store requires", () => {
    expect(manifest.id).toBe("osr-tools");
    expect(typeof manifest.name).toBe("string");
    expect(typeof manifest.description).toBe("string");
    expect(typeof manifest.author).toBe("string");
    expect(typeof manifest.isDesktopOnly).toBe("boolean");
    expect(typeof manifest.version).toBe("string");
    expect(typeof manifest.minAppVersion).toBe("string");
    expect(manifest.version as string).toMatch(SEMVER);
    expect(manifest.minAppVersion as string).toMatch(SEMVER);
  });

  it("package.json and manifest.json declare the same version", () => {
    expect(pkg.version).toBe(manifest.version);
  });

  it("versions.json maps the current manifest version to its minAppVersion", () => {
    // Obsidian reads versions.json to pick the newest plugin build a given app version may install.
    for (const [pluginVersion, minApp] of Object.entries(versions)) {
      expect(pluginVersion).toMatch(SEMVER);
      expect(String(minApp)).toMatch(SEMVER);
    }
    expect(versions[manifest.version as string]).toBe(manifest.minAppVersion);
  });
});
