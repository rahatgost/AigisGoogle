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

/**
 * Auth-specific error translator for supabase.auth.* calls. Keeps messages
 * short, non-technical, and localizable by the caller (falls back to English).
 */
export function friendlyAuthError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (!m) return "Something went wrong.";
  if (/invalid.*credent|invalid.*login|invalid_grant/.test(m))
    return "Email or password is incorrect.";
  if (/email.*not.*confirm|email_not_confirmed/.test(m))
    return "Please confirm your email — check your inbox for the link.";
  if (/user.*already.*registered|already.*registered|user_already_exists/.test(m))
    return "An account with that email already exists. Try signing in instead.";
  if (/password.*should be at least|password.*too short|weak.?password/.test(m))
    return "Password is too short — use at least 8 characters.";
  if (/password.*pwned|leaked|breach/.test(m))
    return "That password appeared in a known breach. Please pick another one.";
  if (/invalid.*email|email.*invalid|email address.*invalid/.test(m))
    return "That email address doesn't look right.";
  if (/over_email_send_rate|email.*rate.*limit|rate limit.*email/.test(m))
    return "We've sent too many emails to this address recently. Try again in a few minutes.";
  if (/rate limit|too many|429/.test(m))
    return "Too many attempts — please wait a moment and try again.";
  if (/failed to fetch|network|offline|networkerror/.test(m))
    return "You appear to be offline. Check your connection and try again.";
  if (/token.*expired|jwt.*expired|session.*expired/.test(m))
    return "Your link expired. Request a new one and try again.";
  if (/otp.*expired|otp_expired/.test(m))
    return "That code or link has expired — request a new one.";
  if (/user.*not.*found/.test(m))
    return "No account found for that email.";
  if (/signup.*disabled/.test(m))
    return "New sign-ups are currently disabled.";
  if (/captcha/.test(m))
    return "Captcha check failed — please try again.";
  return raw || "Something went wrong.";
}
