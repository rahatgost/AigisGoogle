/**
 * Stricter i18n check for high-visibility components.
 *
 * `i18n-ids.test.ts` proves every id used somewhere in `src/` exists in the
 * English source and that other locales have no orphan keys — but it lets
 * a locale silently omit a key (English fallback kicks in). For a small
 * hand-picked list of critical UI surfaces we want stronger guarantees:
 *
 *   1. Every id referenced by the file exists in EVERY locale catalog
 *      (no silent English fallback for these strings).
 *   2. ICU-style placeholders (`{count}`, `{issuer}`, …) present in the
 *      English source appear in each translation. A missing placeholder
 *      means the translated string will render literal `{count}` or drop
 *      the interpolated value entirely.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { messages as EN } from "../../locales/en/messages";
import { messages as ES } from "../../locales/es/messages";
import { messages as PT_BR } from "../../locales/pt-BR/messages";
import { messages as FR } from "../../locales/fr/messages";
import { messages as DE } from "../../locales/de/messages";
import { messages as JA } from "../../locales/ja/messages";
import { messages as HI } from "../../locales/hi/messages";
import { messages as BN } from "../../locales/bn/messages";

const SRC = resolve(__dirname, "..", "..");

const CRITICAL_FILES = [
  "components/aegis/plan-comparison-sheet.tsx",
  "components/aegis/sharing-section.tsx",
  "components/vault/AccountCard.tsx",
  "routes/_authenticated/_tabs/vault.tsx",
];

const CALL_PATTERNS: RegExp[] = [
  /\bi18n\._\(\s*["']([^"']+)["']/g,
  /\bt\(\s*["']([^"']+)["']\s*,/g,
  /<Trans\s+id=["']([^"']+)["']/g,
];

const LOCALES: Array<[string, Record<string, string>]> = [
  ["es", ES],
  ["pt-BR", PT_BR],
  ["fr", FR],
  ["de", DE],
  ["ja", JA],
  ["hi", HI],
  ["bn", BN],
];

function idsFor(relPath: string): string[] {
  const source = readFileSync(resolve(SRC, relPath), "utf8");
  const ids = new Set<string>();
  for (const re of CALL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)+$/.test(m[1])) ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

function placeholders(s: string): string[] {
  return (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();
}

describe("i18n — critical components fully translated", () => {
  for (const rel of CRITICAL_FILES) {
    const ids = idsFor(rel);

    it(`${rel}: every used id exists in English source`, () => {
      const missing = ids.filter((id) => !(id in EN));
      expect(missing, `Missing from en: ${missing.join(", ")}`).toEqual([]);
    });

    for (const [name, cat] of LOCALES) {
      it(`${rel}: locale ${name} defines every id and preserves placeholders`, () => {
        const missing: string[] = [];
        const mismatched: string[] = [];
        for (const id of ids) {
          if (!(id in EN)) continue; // covered by the EN test above
          if (!(id in cat)) {
            missing.push(id);
            continue;
          }
          const enP = placeholders(EN[id]);
          const locP = placeholders(cat[id]);
          if (enP.join("|") !== locP.join("|")) {
            mismatched.push(`${id} (en=${enP.join(",") || "∅"} vs ${name}=${locP.join(",") || "∅"})`);
          }
        }
        expect(
          { missing, mismatched },
          `Locale ${name} for ${rel}:\n  missing: ${missing.join(", ") || "none"}\n  mismatched placeholders: ${mismatched.join("; ") || "none"}`,
        ).toEqual({ missing: [], mismatched: [] });
      });
    }
  }
});
