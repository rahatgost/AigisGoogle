/**
 * Single source of truth for Chrome Web Store (CWS) and Firefox Add-ons (AMO)
 * listing metadata. Every URL, justification string, and required link the
 * publishing checklists reference lives here — so a domain change or policy
 * update only needs to happen in one place.
 *
 * Precedence for every field:
 *   1. Environment variable (VITE_EXT_*) — overrides at build time
 *   2. Fallback baked into this file
 *
 * Consumed by:
 *   - extension/vite.config.ts → injects `homepage_url` into manifest.json,
 *     emits `<target>-store-listing.json` next to the build for CI/humans.
 *   - docs/extension-publishing.md → references the same fields by name.
 */

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "..");

function readEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw && raw.length > 0) return raw;
  try {
    const dotenv = fs.readFileSync(path.join(PROJECT_ROOT, ".env"), "utf8");
    const line = dotenv.split("\n").find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).replace(/^"|"$/g, "").trim();
  } catch {
    /* .env missing is fine in CI */
  }
  return fallback;
}

const APP_URL = readEnv("VITE_APP_URL", "https://hug-machine-maker.lovable.app");

export interface StoreListingConfig {
  /** Public homepage of the app — used as `homepage_url` in the manifest. */
  homepageUrl: string;
  /** Required by CWS + AMO. Must be a public, non-authenticated URL. */
  privacyPolicyUrl: string;
  /** Required by CWS. Terms of Service page. */
  termsUrl: string;
  /** User-facing support / contact URL (CWS "Support" field, AMO "Support site"). */
  supportUrl: string;
  /** Email shown on the store listing. CWS requires a verified address. */
  supportEmail: string;
  /** Optional public source-code URL. AMO strongly recommends it for reviewers. */
  sourceCodeUrl: string;
  /** CWS "Single purpose" statement. Keep to one sentence. */
  singlePurpose: string;
  /** CWS category. */
  category: string;
  /** Per-permission justification strings surfaced during CWS review. */
  permissionJustifications: Record<string, string>;
  /** AMO reviewer notes — build steps + test account guidance. */
  reviewerNotes: string;
}

export const storeListing: StoreListingConfig = {
  homepageUrl: readEnv("VITE_EXT_HOMEPAGE_URL", APP_URL),
  privacyPolicyUrl: readEnv("VITE_EXT_PRIVACY_URL", `${APP_URL}/privacy`),
  termsUrl: readEnv("VITE_EXT_TERMS_URL", `${APP_URL}/terms`),
  supportUrl: readEnv("VITE_EXT_SUPPORT_URL", `${APP_URL}/support`),
  supportEmail: readEnv("VITE_EXT_SUPPORT_EMAIL", "support@aegis.local"),
  sourceCodeUrl: readEnv("VITE_EXT_SOURCE_URL", ""),
  singlePurpose: readEnv(
    "VITE_EXT_SINGLE_PURPOSE",
    "Auto-fills time-based one-time passcodes (TOTP) from the user's Aegis vault.",
  ),
  category: readEnv("VITE_EXT_CATEGORY", "Productivity / Password Managers"),
  permissionJustifications: {
    storage: "Holds the HMAC pairing key and clipboard-clear alarm state locally.",
    activeTab: "Reads the current tab's URL to rank matching TOTP accounts on demand.",
    scripting: "Injects the OTP value into the focused input after the user clicks Fill.",
    alarms: "Auto-clears the clipboard 30 seconds after the user copies a code.",
    externally_connectable:
      "Only the Aegis app origins (see manifest.externally_connectable.matches) may send messages.",
  },
  reviewerNotes: readEnv(
    "VITE_EXT_REVIEWER_NOTES",
    [
      "Build: `bun install && bun run build:ext` (Chrome) or `bun run build:ext:firefox`.",
      "The extension is fully client-side; no test account required for the popup UI.",
      "To exercise autofill end-to-end, create a free account at the homepage URL, add a TOTP entry, then open any login form.",
    ].join("\n"),
  ),
};
