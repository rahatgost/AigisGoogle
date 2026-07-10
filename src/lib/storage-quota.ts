// Storage quota / persistence helpers.
//
// The offline vault mirror lives in IndexedDB. In a normal browser
// storage bucket that data is *evictable* — if the device runs low on
// disk, the browser can silently delete it, breaking offline mode. We
// mitigate two ways:
//
//   1. Ask the browser to mark our origin "persistent" via
//      `navigator.storage.persist()`. Chrome/Edge/Firefox grant this
//      silently for installed PWAs and permissioned origins; Safari
//      grants it after enough user engagement. Failing the request is
//      harmless — we just fall back to best-effort storage.
//
//   2. Periodically inspect `navigator.storage.estimate()` and surface
//      a warning once we cross ~85% of the quota so the user can free
//      space (usually by clearing avatar/icon caches) before the browser
//      does it for them.
//
// Both APIs are gated behind feature detection — the module never throws
// in an environment that doesn't support them.

const HIGH_WATERMARK = 0.85;

export interface StorageStatus {
  supported: boolean;
  persistent: boolean;
  usage: number | null;
  quota: number | null;
  /** usage / quota in the range [0, 1], or null when unknown. */
  ratio: number | null;
  /** True when we're above HIGH_WATERMARK and should warn the user. */
  nearLimit: boolean;
}

function hasStorageApi(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined"
  );
}

/**
 * Ask the browser to keep our data around even under storage pressure.
 * Idempotent — if we already have persistence there's no user-visible
 * side effect. Returns the final persistence state.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!hasStorageApi() || typeof navigator.storage.persist !== "function") {
    return false;
  }
  try {
    if (typeof navigator.storage.persisted === "function") {
      const already = await navigator.storage.persisted();
      if (already) return true;
    }
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Read the current storage estimate. Safe to call anywhere. */
export async function getStorageStatus(): Promise<StorageStatus> {
  const base: StorageStatus = {
    supported: false,
    persistent: false,
    usage: null,
    quota: null,
    ratio: null,
    nearLimit: false,
  };
  if (!hasStorageApi()) return base;
  const supported = typeof navigator.storage.estimate === "function";
  let persistent = false;
  try {
    if (typeof navigator.storage.persisted === "function") {
      persistent = await navigator.storage.persisted();
    }
  } catch {
    persistent = false;
  }
  if (!supported) return { ...base, supported: false, persistent };
  try {
    const est = await navigator.storage.estimate();
    const usage = typeof est.usage === "number" ? est.usage : null;
    const quota = typeof est.quota === "number" ? est.quota : null;
    const ratio = usage !== null && quota && quota > 0 ? usage / quota : null;
    const nearLimit = ratio !== null && ratio >= HIGH_WATERMARK;
    return {
      supported: true,
      persistent,
      usage,
      quota,
      ratio,
      nearLimit,
    };
  } catch {
    return { ...base, supported: true, persistent };
  }
}

export const STORAGE_HIGH_WATERMARK = HIGH_WATERMARK;
