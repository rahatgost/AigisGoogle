// Central translator for raw backend/DB errors into short, human-readable
// strings. Postgres `RAISE EXCEPTION` messages (from the vault_accounts
// quota trigger, family cap, rate limiter) surface verbatim through the
// Data API; storage returns its own set of failure modes. This helper
// normalizes both so the UI never leaks trigger names or SQLSTATE codes.

export function friendlyVaultSaveError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("vault account limit reached")) {
    return "You've reached the Free plan's 25-account limit. Upgrade to Pro to store up to 500.";
  }
  if (m.includes("rate limit") && m.includes("vault accounts")) {
    return "Too many new accounts in a short window — wait a moment and try again.";
  }
  if (m.includes("row-level security") || m.includes("row level security") || m.includes("not authorized")) {
    return "Backend rejected the save (permission denied). Try signing out and back in.";
  }
  if (m.includes("jwt") || m.includes("unauthorized") || m.includes("401")) {
    return "Session expired — sign in again to save.";
  }
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network error")) {
    return "Network unavailable — the account will save when you're back online.";
  }
  return raw || "Could not save.";
}
