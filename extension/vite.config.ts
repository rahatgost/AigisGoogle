// Second Vite entry point — builds the MV3 browser extension into
// `dist-ext/`. Kept intentionally separate from the web app's TanStack
// Start build so extension bundling can't perturb SSR output.
//
// The vault modules under `src/lib/*` are consumed verbatim via the `@/`
// alias — no copying, no forking. If a vault primitive changes, both the
// web app and the extension pick it up on the next build.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { storeListing } from "./store-listing.config";

const ROOT = path.resolve(__dirname);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const TARGET_DIR = (process.env.TARGET ?? "chrome").toLowerCase() === "firefox" ? "dist-ext-firefox" : "dist-ext";
const OUT_DIR = path.resolve(PROJECT_ROOT, TARGET_DIR);
const META_DIR = path.resolve(PROJECT_ROOT, "dist-ext-meta");

// Read the same VITE_* env the web app uses so we bake the correct
// Supabase URL into the manifest's CSP `connect-src`.
function readEnv(name: string, fallback = ""): string {
  const raw = process.env[name];
  if (raw && raw.length > 0) return raw;
  try {
    const dotenv = fs.readFileSync(path.join(PROJECT_ROOT, ".env"), "utf8");
    const line = dotenv.split("\n").find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).replace(/^"|"$/g, "");
  } catch {
    /* .env missing is fine in CI */
  }
  return fallback;
}

const SUPABASE_URL = readEnv("VITE_SUPABASE_URL");
const SUPABASE_ORIGIN = SUPABASE_URL ? new URL(SUPABASE_URL).origin : "https://*.supabase.co";

// Aegis app origins the extension is allowed to talk to. Precedence:
//   1. VITE_APP_URL         — production URL (custom domain when set)
//   2. VITE_APP_PREVIEW_URL — Lovable preview URL for this project
//   3. Hardcoded fallbacks  — so a fresh clone still builds
// Set VITE_APP_URL in `.env` when you point the app at a custom domain;
// the manifest allow-list, popup "Open vault" link, and SW origin regex
// all pick up the new value on the next `bun run build:ext`.
const APP_URL = readEnv("VITE_APP_URL", "https://aegis-v2.flinkeo.online");
const APP_LEGACY_URL = readEnv("VITE_APP_LEGACY_URL", "https://aegis-syed.lovable.app");
const APP_PREVIEW_URL = readEnv(
  "VITE_APP_PREVIEW_URL",
  "https://id-preview--04418077-cd09-40ce-bb05-4708ee844e27.lovable.app",
);
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_LEGACY_ORIGIN = new URL(APP_LEGACY_URL).origin;
const APP_PREVIEW_ORIGIN = new URL(APP_PREVIEW_URL).origin;

/**
 * Emit `manifest.json` + `content.js` alongside the JS bundles. Vite's
 * HTML pipeline handles the popup; background & content need explicit
 * inputs (they're not referenced from any HTML).
 */
// TARGET=chrome (default) or TARGET=firefox switches the emitted manifest
// shape. Firefox MV3 needs `browser_specific_settings.gecko.id` and does
// not support ES-module service workers (as of FF 128), so we downgrade
// the background block to a classic script for that target.
const TARGET = (process.env.TARGET ?? "chrome").toLowerCase() as "chrome" | "firefox";
const GECKO_ID = process.env.GECKO_ID ?? "aegis@lovable.app";

function extensionManifestPlugin() {
  return {
    name: "aegis-extension-manifest",
    apply: "build" as const,
    generateBundle() {
      const source = fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8");
      let rendered = source
        .replaceAll("__SUPABASE_ORIGIN__", SUPABASE_ORIGIN)
        .replaceAll("__APP_ORIGIN__", APP_ORIGIN)
        .replaceAll("__APP_LEGACY_ORIGIN__", APP_LEGACY_ORIGIN)
        .replaceAll("__APP_PREVIEW_ORIGIN__", APP_PREVIEW_ORIGIN);

      // Inject store-listing homepage URL so `chrome://extensions` and AMO
      // both show a working "Homepage" link. Sourced from store-listing.config.ts.
      const parsedBase = JSON.parse(rendered);
      parsedBase.homepage_url = storeListing.homepageUrl;
      rendered = JSON.stringify(parsedBase, null, 2);

      if (TARGET === "firefox") {
        const parsed = JSON.parse(rendered);
        // Firefox MV3: classic background scripts, no `type: module`.
        parsed.background = { scripts: ["background.js"] };
        // Firefox rejects `minimum_chrome_version`.
        delete parsed.minimum_chrome_version;
        parsed.browser_specific_settings = {
          gecko: { id: GECKO_ID, strict_min_version: "128.0" },
        };
        rendered = JSON.stringify(parsed, null, 2);
      }

      // Ship icons alongside the manifest so `chrome://extensions` and
      // the toolbar toolbar-action render at every DPR.
      for (const size of [16, 32, 48, 128]) {
        const iconPath = path.join(ROOT, `icons/icon-${size}.png`);
        if (fs.existsSync(iconPath)) {
          // @ts-expect-error - rollup plugin context is untyped here
          this.emitFile({
            type: "asset",
            fileName: `icons/icon-${size}.png`,
            source: fs.readFileSync(iconPath),
          });
        }
      }

      // @ts-expect-error - rollup plugin context is untyped here
      this.emitFile({ type: "asset", fileName: "manifest.json", source: rendered });

      // Write the store-listing metadata OUTSIDE the extension bundle
      // (stores reject unexpected files inside the zip). CI + humans read
      // this to fill out CWS / AMO forms without re-typing URLs.
      try {
        fs.mkdirSync(META_DIR, { recursive: true });
        fs.writeFileSync(
          path.join(META_DIR, `${TARGET}-store-listing.json`),
          JSON.stringify(
            { target: TARGET, version: parsedBase.version, ...storeListing },
            null,
            2,
          ),
        );
      } catch (err) {
        console.warn("[aegis-ext] failed to write store-listing meta:", err);
      }
    },
  };
}


export default defineConfig({
  root: ROOT,
  plugins: [react(), extensionManifestPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(PROJECT_ROOT, "src"),
    },
  },
  define: {
    // The vault modules read `import.meta.env.VITE_SUPABASE_*` transitively
    // via the shared Supabase client. Populate them at build time so the
    // extension SW/popup can talk to the same backend the web app uses.
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(SUPABASE_URL),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      readEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
    ),
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(
      readEnv("VITE_SUPABASE_PROJECT_ID"),
    ),
    // Aegis app origins baked in at build time. Both SW (allow-list regex)
    // and popup ("Open vault" link) read these.
    __AEGIS_APP_URL__: JSON.stringify(APP_URL),
    __AEGIS_APP_ORIGIN__: JSON.stringify(APP_ORIGIN),
    __AEGIS_APP_PREVIEW_ORIGIN__: JSON.stringify(APP_PREVIEW_ORIGIN),
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    sourcemap: false,
    target: "chrome110",
    // Extension pages must not contain inline scripts (MV3 CSP forbids
    // 'unsafe-inline'). Vite would otherwise inline the modulepreload
    // polyfill and small chunks.
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        popup: path.join(ROOT, "src/popup/index.html"),
        background: path.join(ROOT, "src/background.ts"),
        content: path.join(ROOT, "src/content.ts"),
        announce: path.join(ROOT, "src/announce.ts"),
      },
      output: {
        // Service worker + content scripts must live at stable paths the
        // manifest can reference. Everything else gets Vite's hashed name.
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "content") return "content.js";
          if (chunk.name === "announce") return "announce.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
