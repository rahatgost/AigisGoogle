/**
 * i18n string-freeze CI check (see docs/i18n.md).
 *
 * Walks the React source tree and extracts every translation id used via
 * `i18n._("id", …)`, `t("id", …)` (the local Profile/Vault helper), and
 * `<Trans id="id">…</Trans>`. Asserts:
 *
 *   1. Every id used at a call site exists in the English source catalog
 *      (`src/locales/en/messages.ts`). This prevents the "silent English
 *      fallback" that used to hide typos.
 *
 *   2. Every sibling locale catalog exports the same shape (missing ids
 *      are fine and fall back to English by design; extra ids are a bug
 *      — they mean the English key was renamed but a translation was
 *      left behind).
 *
 * This replaces `@lingui/cli`'s extractor for CI. The extractor is still
 * the right tool locally for authoring; we just don't want to add its
 * Babel toolchain to the CI graph.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { messages as EN } from "../../locales/en/messages";
import { messages as ES } from "../../locales/es/messages";
import { messages as PT_BR } from "../../locales/pt-BR/messages";
import { messages as FR } from "../../locales/fr/messages";
import { messages as DE } from "../../locales/de/messages";
import { messages as JA } from "../../locales/ja/messages";
import { messages as HI } from "../../locales/hi/messages";
import { messages as BN } from "../../locales/bn/messages";

const SRC = resolve(__dirname, "..", "..");

/** Recursively collect .ts/.tsx files under `src/`, skipping generated/test files. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      // Skip generated catalog files and route tree.
      if (full.includes("/locales/")) continue;
      if (full.endsWith("routeTree.gen.ts")) continue;
      out.push(full);
    }
  }
  return out;
}

// Match `i18n._("id", …)`, `t("id", …)` (Profile/Vault helper),
// and `<Trans id="id"` (double or single quotes). We deliberately only
// match string-literal ids — dynamic ids (`i18n._(variable)`) can't be
// verified statically and are rare enough in this codebase.
const CALL_PATTERNS: RegExp[] = [
  /\bi18n\._\(\s*["']([^"']+)["']/g,
  /\bt\(\s*["']([^"']+)["']\s*,/g,
  /<Trans\s+id=["']([^"']+)["']/g,
];

function extractIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of walk(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const re of CALL_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        // Filter obvious false positives: dot-separated feature keys only.
        // Every real Aegis id looks like "profile.section.language".
        if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)+$/.test(m[1])) {
          ids.add(m[1]);
        }
      }
    }
  }
  return ids;
}

describe("i18n string coverage", () => {
  const used = extractIds();

  it("every id used in source has an English source string", () => {
    const missing: string[] = [];
    for (const id of used) {
      if (!(id in EN)) missing.push(id);
    }
    expect(
      missing.sort(),
      `Ids referenced in source but missing from src/locales/en/messages.ts:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  const catalogs: Array<[string, Record<string, string>]> = [
    ["es", ES],
    ["pt-BR", PT_BR],
    ["fr", FR],
    ["de", DE],
    ["ja", JA],
    ["hi", HI],
    ["bn", BN],
  ];

  for (const [name, cat] of catalogs) {
    it(`locale ${name} has no orphan keys (all ids exist in en)`, () => {
      const orphans = Object.keys(cat).filter((k) => !(k in EN));
      expect(
        orphans.sort(),
        `Locale ${name} defines ids that no longer exist in the English source:\n  ${orphans.join("\n  ")}`,
      ).toEqual([]);
    });
  }
});
