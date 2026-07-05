// Guarded Service Worker registration. This module is the single call site
// that touches `navigator.serviceWorker` in the app — never register from
// anywhere else. Behaviour follows the PWA skill's Lovable-preview rules:
//
//   • Refuse registration in dev, inside an iframe, on any Lovable
//     preview / sandbox hostname, or when the URL carries `?sw=off`.
//   • In every refused context, actively unregister any matching `/sw.js`
//     registration so a stale worker from an older deploy doesn't keep
//     serving.
//   • In a valid production context, delegate registration to
//     virtual:pwa-register.

const APP_SW_URL = "/sw.js";

function inIframe(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    // Cross-origin iframe access throws — treat as an iframe.
    return true;
  }
}

function isLovablePreviewHost(host: string): boolean {
  return (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  );
}

async function unregisterAppSw(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((r) => {
          const url = r.active?.scriptURL ?? r.waiting?.scriptURL ?? r.installing?.scriptURL ?? "";
          return url.endsWith(APP_SW_URL);
        })
        .map((r) => r.unregister()),
    );
  } catch {
    // Best-effort — a stale registration can be cleaned up on next boot.
  }
}

export function registerAegisServiceWorker(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const url = new URL(window.location.href);
  const host = window.location.hostname;
  const refuse =
    !import.meta.env.PROD ||
    inIframe() ||
    isLovablePreviewHost(host) ||
    url.searchParams.get("sw") === "off";

  if (refuse) {
    void unregisterAppSw();
    return;
  }

  // Register via the plugin-provided virtual module so autoUpdate + reload
  // wiring stays in sync with vite-plugin-pwa.
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({ immediate: true });
    })
    .catch((err) => {
      // Never let a registration failure bubble into React.
      console.warn("[aegis-pwa] service worker registration skipped:", err);
    });
}
