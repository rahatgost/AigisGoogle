// Client-side favorites store. Favorite state is a per-user, per-device
// preference — no need to sync it through the encrypted vault, so we keep it
// in localStorage keyed by user id.

const keyFor = (userId: string) => `aegis:favorites:${userId}`;

export function loadFavorites(userId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x) => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function saveFavorites(userId: string, favorites: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      keyFor(userId),
      JSON.stringify(Array.from(favorites)),
    );
  } catch {
    /* quota — ignore */
  }
}
