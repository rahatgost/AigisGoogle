// Phase 8.2 — theme (dark mode) coordinator.
//
// Ownership: one CSS class (`dark`) on <html>. All colour tokens live in
// `src/styles.css`; components just reference the `--aegis-*` variables
// through the palette constants in `chrome.tsx`, so flipping the class
// swaps the whole app instantly.
//
// Persistence:
// 1. localStorage (`aegis:theme_pref`) — instant, works offline, applied
//    pre-hydration by the inline script in `__root.tsx` so there is no
//    light-mode flash before React mounts.
// 2. `profiles.theme_pref` — synced from the server on sign-in so the
//    preference follows the user across devices.

export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "aegis:theme_pref";

const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#f7f4ed",
  dark: "#14110d",
};

function isThemePref(v: unknown): v is ThemePref {
  return v === "system" || v === "light" || v === "dark";
}

/** Read the persisted preference; defaults to "system". */
export function getThemePref(): ThemePref {
  if (typeof localStorage === "undefined") return "system";
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePref(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/** Resolve a preference to a concrete theme, consulting the OS when "system". */
export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === "light" || pref === "dark") return pref;
  if (typeof window === "undefined") return "light";
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  return mq?.matches ? "dark" : "light";
}

/** Apply a resolved theme to <html> + the mobile theme-color meta tag. */
export function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
}

/** Persist locally and apply immediately. */
export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage disabled — the change still applies for this session.
  }
  applyTheme(resolveTheme(pref));
}

/**
 * Wire the OS-preference listener so a "system" user follows their OS
 * theme changes without needing to reload. Returns an unsubscribe fn.
 */
export function subscribeToSystemTheme(): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (getThemePref() === "system") applyTheme(mq.matches ? "dark" : "light");
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

/**
 * Boot-time initialiser. The inline script in `__root.tsx` handles the
 * pre-hydration paint; this function re-applies (idempotent) and hooks up
 * the system-theme listener once React is mounted.
 */
export function initTheme(): () => void {
  applyTheme(resolveTheme(getThemePref()));
  return subscribeToSystemTheme();
}

/**
 * Inline `<script>` body run pre-hydration so the first paint matches the
 * user's stored preference. Kept intentionally tiny + defensive.
 */
export const THEME_INIT_SCRIPT = `try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var p=localStorage.getItem(k);var t=(p==='light'||p==='dark')?p:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var r=document.documentElement;if(t==='dark')r.classList.add('dark');r.style.colorScheme=t;var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.setAttribute('content',t==='dark'?'#14110d':'#f7f4ed');}catch(e){}`;
