// Phase 8.3 — localization coordinator.
//
// Ownership: one `i18n` instance from `@lingui/core`, wrapped at the app
// root by `<I18nProvider>` in `src/routes/__root.tsx`. Every visible string
// funnels through `<Trans id="...">Fallback</Trans>` (or `i18n._("id")`);
// missing catalog entries fall back to the English default provided at the
// call site, so partial translations are always safe.
//
// Persistence mirrors `src/lib/theme.ts`:
//   1. localStorage (`aegis:locale`) — instant, works offline, applied pre-
//      hydration by the inline script in `__root.tsx` so `<html lang>` and
//      the active locale are set before React mounts.
//   2. `profiles.locale` — synced from the server on sign-in so the
//      preference follows the user across devices.
//
// The catalogs live under `src/locales/{code}/messages.ts`. We statically
// import all eight so switching is synchronous (no flash of untranslated
// content) — the total payload is small because each catalog is a flat
// string map.

import { i18n } from "@lingui/core";

import { messages as en } from "@/locales/en/messages";
import { messages as es } from "@/locales/es/messages";
import { messages as ptBR } from "@/locales/pt-BR/messages";
import { messages as fr } from "@/locales/fr/messages";
import { messages as de } from "@/locales/de/messages";
import { messages as ja } from "@/locales/ja/messages";
import { messages as hi } from "@/locales/hi/messages";
import { messages as bn } from "@/locales/bn/messages";

export type LocaleCode = "en" | "es" | "pt-BR" | "fr" | "de" | "ja" | "hi" | "bn";
export type LocalePref = "system" | LocaleCode;

export const LOCALE_STORAGE_KEY = "aegis:locale";
export const DEFAULT_LOCALE: LocaleCode = "en";

export interface LocaleMeta {
  code: LocaleCode;
  label: string; // English label, shown as the secondary line
  nativeLabel: string; // Native name, shown as the primary line
}

export const SUPPORTED_LOCALES: LocaleMeta[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "pt-BR", label: "Portuguese (Brazil)", nativeLabel: "Português (Brasil)" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { code: "bn", label: "Bengali", nativeLabel: "বাংলা" },
];

import { compileMessage } from "@lingui/message-utils/compileMessage";

const RAW_CATALOGS: Record<LocaleCode, Record<string, string>> = {
  en,
  es,
  "pt-BR": ptBR,
  fr,
  de,
  ja,
  hi,
  bn,
};

// Pre-compile every catalog entry into Lingui's tokenized form. This is
// what `lingui compile` would produce on disk — doing it once at module
// load keeps our flat `Record<string, string>` source files simple while
// eliminating the "Uncompiled message detected" runtime warning and
// enabling ICU interpolation / plurals for translated strings.
function compileCatalog(raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key in raw) {
    const src = raw[key];
    try {
      out[key] = compileMessage(src);
    } catch {
      out[key] = src;
    }
  }
  return out;
}

const CATALOGS: Record<LocaleCode, Record<string, unknown>> = {
  en: compileCatalog(RAW_CATALOGS.en),
  es: compileCatalog(RAW_CATALOGS.es),
  "pt-BR": compileCatalog(RAW_CATALOGS["pt-BR"]),
  fr: compileCatalog(RAW_CATALOGS.fr),
  de: compileCatalog(RAW_CATALOGS.de),
  ja: compileCatalog(RAW_CATALOGS.ja),
  hi: compileCatalog(RAW_CATALOGS.hi),
  bn: compileCatalog(RAW_CATALOGS.bn),
};

// Preload all catalogs into the shared `i18n` instance once, at module
// evaluation. `activate()` just flips the pointer.
for (const meta of SUPPORTED_LOCALES) {
  i18n.load(meta.code, CATALOGS[meta.code] as Record<string, string>);
}
i18n.activate(DEFAULT_LOCALE);

function isLocaleCode(v: unknown): v is LocaleCode {
  return SUPPORTED_LOCALES.some((l) => l.code === v);
}

function isLocalePref(v: unknown): v is LocalePref {
  return v === "system" || isLocaleCode(v);
}

/** Read the persisted preference; defaults to "system". */
export function getLocalePref(): LocalePref {
  if (typeof localStorage === "undefined") return "system";
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocalePref(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/**
 * Best-effort match of the browser's preferred locales against the eight we
 * support. `navigator.languages` is walked in priority order; region-tagged
 * strings like `pt-BR` match first, then the language part alone (`pt` →
 * `pt-BR`). Falls back to English if nothing matches.
 */
export function detectBrowserLocale(): LocaleCode {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language,
  ].filter(Boolean) as string[];
  for (const raw of candidates) {
    const tag = raw.trim();
    if (!tag) continue;
    if (isLocaleCode(tag)) return tag;
    const short = tag.toLowerCase().split(/[-_]/)[0];
    const match = SUPPORTED_LOCALES.find(
      (l) => l.code.toLowerCase().split("-")[0] === short,
    );
    if (match) return match.code;
  }
  return DEFAULT_LOCALE;
}

/** Resolve a preference to a concrete locale, consulting the browser for "system". */
export function resolveLocale(pref: LocalePref): LocaleCode {
  return pref === "system" ? detectBrowserLocale() : pref;
}

/** Apply a locale to `i18n` and to `<html lang>`. */
export function applyLocale(code: LocaleCode): void {
  if (!isLocaleCode(code)) return;
  i18n.activate(code);
  if (typeof document !== "undefined") {
    document.documentElement.lang = code;
  }
}

/** Persist a preference locally and apply immediately. */
export function setLocalePref(pref: LocalePref): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, pref);
  } catch {
    // Storage disabled — the change still applies for this session.
  }
  applyLocale(resolveLocale(pref));
}

/**
 * Boot-time initialiser. The inline script in `__root.tsx` handles the pre-
 * hydration `<html lang>` set; this function re-applies (idempotent) once
 * React is mounted so the `i18n` runtime matches the DOM.
 */
export function initLocale(): void {
  applyLocale(resolveLocale(getLocalePref()));
}

/**
 * Inline `<script>` body run pre-hydration so `<html lang>` matches the
 * user's stored preference on the very first paint. Kept intentionally tiny
 * + defensive — the full runtime lives in this module.
 */
export const LOCALE_INIT_SCRIPT = `try{var k=${JSON.stringify(LOCALE_STORAGE_KEY)};var s=${JSON.stringify(SUPPORTED_LOCALES.map((l) => l.code))};var p=localStorage.getItem(k);var pick=function(t){if(!t)return null;if(s.indexOf(t)>-1)return t;var short=String(t).toLowerCase().split(/[-_]/)[0];for(var i=0;i<s.length;i++){if(s[i].toLowerCase().split('-')[0]===short)return s[i];}return null;};var l=null;if(p&&p!=='system'&&s.indexOf(p)>-1)l=p;if(!l){var langs=(navigator.languages||[navigator.language||'en']);for(var i=0;i<langs.length&&!l;i++)l=pick(langs[i]);}if(!l)l='en';document.documentElement.lang=l;}catch(e){}`;

export { i18n };
