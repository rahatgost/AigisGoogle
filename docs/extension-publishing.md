# Aegis Extension — Publishing & Distribution

## Version 0.2.0 (PR 3)

**Security:**
- HMAC-SHA256 pairing between web app ↔ extension SW. First push fetches a
  32-byte random key via `GET_PAIRING`; every subsequent `SYNC_VAULT` is
  signed with timestamp + nonce and rejected on stale/replayed/tampered
  payloads.
- Nonce cache (5-min window) + ±60 s timestamp skew tolerance.
- HMAC failure auto-clears the cached key and re-pairs (one silent retry).

**Distribution:**
- Icons at 16/32/48/128 shipped from `extension/icons/`.
- Firefox MV3 build: `bun run build:ext:firefox` → `dist-ext-firefox/`.
- CWS-ready zip: `bun run package:ext:chrome` → `public/aegis-extension-chrome.zip`.
- AMO-ready zip: `bun run package:ext:firefox` → `public/aegis-extension-firefox.zip`.

## Chrome Web Store submission

1. `bun run package:ext:chrome`
2. Open https://chrome.google.com/webstore/devconsole (one-time $5 fee).
3. **New item** → upload `public/aegis-extension-chrome.zip`.
4. Store listing:
   - **Description:** copy from `extension/manifest.json` (`description`) and expand.
   - **Category:** *Productivity → Password Managers*.
   - **Icons:** 128×128 auto-picked from `icons/icon-128.png`.
   - **Screenshots:** 1280×800 or 640×400 (min 1, max 5) — capture popup + fill-in-page flows.
   - **Privacy policy URL:** required. Use `<APP_URL>/privacy` (add page to web app if missing).
5. **Permissions justification:**
   - `storage` → holds the HMAC pairing key and clipboard-clear alarms.
   - `activeTab` → read current tab URL to rank matching accounts.
   - `scripting` → auto-fill the focused OTP input on user click.
   - `alarms` → auto-clear clipboard 30 s after copy.
   - `externally_connectable` → only the two Aegis app origins (see manifest).
6. **Single-purpose statement:** "Auto-fills time-based one-time passcodes (TOTP) from the user's Aegis vault."
7. Submit for review (typically 1–3 business days).

## Firefox Add-ons (AMO) submission

1. `bun run package:ext:firefox`
2. Open https://addons.mozilla.org/developers/ (free account).
3. **Submit a new add-on** → upload `public/aegis-extension-firefox.zip`.
4. Same listing content as CWS.
5. `browser_specific_settings.gecko.id` is baked in as `aegis@lovable.app` (override with `GECKO_ID=…`).
6. Firefox requires `strict_min_version: "128.0"` (MV3 stability threshold).

## Custom domain re-build

When you point the web app at a custom domain (e.g. `aegis.example.com`):

1. Set `VITE_APP_URL=https://aegis.example.com` in `.env`.
2. `bun run package:ext:chrome && bun run package:ext:firefox`
3. Re-upload both zips as **new versions** (bump `manifest.json` `version`).
4. Existing installs continue to work until users update — the old allow-list
   still matches the old origin.

## Version bumping

Bump `extension/manifest.json` → `version` on every store upload. Stores
reject uploads with a version equal to or lower than what is already published.
