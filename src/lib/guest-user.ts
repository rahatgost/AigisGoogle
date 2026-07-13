/**
 * Guest / local-only user mode.
 *
 * When no Supabase session exists, we synthesize a stable "guest" user
 * so the whole app can work offline against local encrypted storage.
 * Cloud-only features (Backup, Family, Devices, Emergency, Sharing,
 * Extension pairing, Push, Sign-in history, Subscription) show a
 * "Sign in to unlock" affordance in Profile.
 *
 * The guest id is a v4 UUID prefixed with `guest-` so we can tell it
 * apart from a real auth.users id anywhere in the code.
 */

const GUEST_ID_KEY = "aegis.guest.id.v1";
const GUEST_ONBOARDED_KEY = "aegis.guest.onboarded.v1";

function newUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isGuestId(id: string | null | undefined): boolean {
  return !!id && id.startsWith("guest-");
}

export function getOrCreateGuestId(): string {
  if (typeof window === "undefined") return "guest-ssr";
  try {
    const existing = window.localStorage.getItem(GUEST_ID_KEY);
    if (existing) return existing;
    const id = `guest-${newUuid()}`;
    window.localStorage.setItem(GUEST_ID_KEY, id);
    return id;
  } catch {
    return `guest-${newUuid()}`;
  }
}

/** Cheap module-level check used by hot paths (vault-cache.isOffline). */
export function isGuestMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!window.localStorage.getItem(GUEST_ID_KEY);
  } catch {
    return false;
  }
}

export function isGuestOnboarded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GUEST_ONBOARDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markGuestOnboarded(): void {
  try {
    window.localStorage.setItem(GUEST_ONBOARDED_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearGuestState(): void {
  try {
    window.localStorage.removeItem(GUEST_ID_KEY);
    window.localStorage.removeItem(GUEST_ONBOARDED_KEY);
  } catch {
    /* ignore */
  }
}
