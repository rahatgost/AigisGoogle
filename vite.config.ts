// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          // Manual chunk-split so the router runtime, Supabase client, and
          // heavy vendor libs live in their own long-cacheable chunks
          // instead of being duplicated across route bundles. Route code
          // stays split automatically by TanStack's code-splitter.
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("@tanstack/react-router") || id.includes("@tanstack/router-core") || id.includes("@tanstack/history")) {
              return "tanstack-router";
            }
            if (id.includes("@tanstack/react-start") || id.includes("@tanstack/start-")) {
              return "tanstack-start";
            }
            if (id.includes("@supabase/")) return "supabase";
            if (id.includes("framer-motion")) return "framer-motion";
            if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) {
              return "react";
            }
            if (id.includes("lucide-react")) return "icons";
          },
        },
      },
    },
    plugins: [
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        // The plugin never injects its own registration. Our guarded wrapper
        // in src/lib/pwa-register.ts is the single call site so preview and
        // sandbox contexts never register a service worker.
        injectRegister: null,
        devOptions: { enabled: false },
        filename: "sw.js",
        // TanStack Start + Nitro splits Vite's outDir into `dist/client` (browser)
        // and `dist/server` (worker). vite-plugin-pwa infers from Vite's own
        // build.outDir which is `dist/`, so without this override the SW and
        // manifest.webmanifest end up siblings of the client bundle instead
        // of inside it — and never get served.
        outDir: "dist/client",
        includeAssets: [
          "favicon.ico",
          "icon-192.png",
          "icon-512.png",
          "icon-maskable-512.png",
          "apple-touch-icon.png",
        ],
        manifest: {
          name: "Aegis Authenticator",
          short_name: "Aegis",
          description:
            "Zero-knowledge, end-to-end encrypted TOTP authenticator that works offline.",
          start_url: "/vault",
          scope: "/",
          id: "/",
          display: "standalone",
          orientation: "portrait",
          background_color: "#f7f4ed",
          theme_color: "#f7f4ed",
          categories: ["utilities", "productivity", "security"],
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            {
              src: "/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
          // Deep-link support: services that hand out `otpauth://` URIs
          // (e.g. share-sheet from a native app, external QR reader) route
          // straight into Add Account with the URI in the query string.
          // Chrome's protocol-handler safelist includes `otpauth`.
          protocol_handlers: [
            { protocol: "otpauth", url: "/vault/new?uri=%s" },
          ],
          // Share Target: iOS / Android share-sheet can send an `otpauth://`
          // URL (text or url payload) into the same Add Account flow.
          share_target: {
            action: "/vault/new",
            method: "GET",
            params: { title: "issuer", text: "uri", url: "uri" },
          },
        },
        workbox: {
          globPatterns: ["**/*.{js,css,ico,png,svg,webmanifest,woff,woff2}"],
          // TanStack Start + Nitro doesn't emit a static index.html — SSR
          // renders every navigation. So there's no precached "shell" URL
          // to fall back to; instead the NetworkFirst navigation handler
          // below serves whichever route the user previously visited from
          // its own runtime cache. `navigateFallback` intentionally omitted.
          navigateFallbackDenylist: [
            /^\/~oauth/,
            /^\/api\//,
            /^\/auth\/callback/,
            /^\/auth\/reset-password/,
          ],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // HTML shell — network-first so a new deploy takes effect on the
              // next successful load, but a cached copy keeps offline working.
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" &&
                !url.pathname.startsWith("/~oauth") &&
                !url.pathname.startsWith("/api/") &&
                !url.pathname.startsWith("/auth/callback") &&
                !url.pathname.startsWith("/auth/reset-password"),
              handler: "NetworkFirst",
              options: {
                cacheName: "aegis-html",
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
            {
              // Google Fonts stylesheet — SWR keeps them fresh without blocking.
              urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
              handler: "StaleWhileRevalidate",
              options: { cacheName: "google-fonts-css" },
            },
            {
              // Google Fonts binary files — cache-first, they're immutable per URL.
              urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-files",
                expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },

      }),
    ],
  },
});
