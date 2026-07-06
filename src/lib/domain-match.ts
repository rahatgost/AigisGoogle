// Fuzzy issuer↔host matcher for autofill (Phase 10.2).
//
// When a user focuses an OTP field on, say, `accounts.github.com`, the
// extension needs to surface the vault account whose `issuer` is
// "GitHub" (or "Github Enterprise", or "github-work"). This module is
// the pure logic behind that ranking: no DOM, no chrome APIs, no
// network — so it can be unit-tested in the node vitest env and
// consumed identically by the content script, background SW, and popup.
//
// The scoring is intentionally simple. Real autofill quality on the top
// 20 sites (see Phase 10 exit criteria) comes from the *tokenisation*
// step — chopping "accounts.github.com" into ["github"] and
// "GitHub (work)" into ["github", "work"] — not from an elaborate edit
// distance. Two identical tokens beats a fuzzy near-miss every time.
//
// Threshold guidance:
//   score >= 0.85  → auto-fill candidate (single strong match)
//   score >= 0.55  → offer in the picker
//   score  < 0.55  → hide (too noisy to be useful)

/**
 * Common "service" second-level domains we treat as noise when tokenising
 * hosts. Without this, `github.io` would tokenise to `["github","io"]`
 * and an issuer literally named "IO" would win over "GitHub".
 */
const TLD_STOPWORDS = new Set([
  "com", "net", "org", "io", "co", "app", "dev", "cloud", "xyz",
  "info", "biz", "us", "uk", "eu", "de", "fr", "jp", "cn", "in",
  "ai", "sh", "me", "tv", "gg", "so", "to",
]);

/**
 * Words we strip from issuers before tokenising. Nothing here changes
 * whether a match is possible — they're pure noise, but leaving them in
 * dilutes the Jaccard score.
 */
const ISSUER_STOPWORDS = new Set([
  "account", "accounts", "auth", "authentication", "login", "signin",
  "inc", "llc", "ltd", "the", "www", "app", "com", "cloud",
]);

/** Lowercase, strip protocol/path/port, drop leading `www.`. */
export function normalizeHost(input: string): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  // Accept full URLs or bare hosts.
  try {
    if (/^https?:\/\//.test(s)) s = new URL(s).hostname;
  } catch {
    /* fall through with the raw string */
  }
  s = s.replace(/:\d+$/, "");
  s = s.replace(/^www\./, "");
  return s;
}

/** Split a host into meaningful tokens with TLD stopwords removed. */
export function hostTokens(host: string): string[] {
  const norm = normalizeHost(host);
  if (!norm) return [];
  const parts = norm.split(".").filter(Boolean);
  return parts.filter((p) => !TLD_STOPWORDS.has(p) && p.length > 1);
}

/** Split an issuer + optional label into normalised alphanumeric tokens.
 *  Emails inside the label (the common "alice@example.com" case) are
 *  stripped whole — they identify the *account*, not the brand, and
 *  would otherwise cause the label's email domain to match unrelated
 *  hosts. */
export function issuerTokens(issuer: string, label?: string): string[] {
  const cleanLabel = (label ?? "").replace(/\S+@\S+/g, " ");
  const raw = `${issuer ?? ""} ${cleanLabel}`.toLowerCase();
  const parts = raw.split(/[^a-z0-9]+/).filter(Boolean);
  return parts.filter((p) => !ISSUER_STOPWORDS.has(p) && p.length > 1);
}

/** Return the eTLD+1-ish "primary label" — the token most likely to be the brand. */
export function primaryHostLabel(host: string): string {
  const t = hostTokens(host);
  // For `accounts.github.com` this is `github`; for `foo.co.uk` we lose
  // the country code because it's a TLD stopword and end up with `foo`.
  return t[t.length - 1] ?? "";
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

/**
 * Score a single (host, issuer) pair on [0, 1]. The score combines:
 *   - primary-label equality       (heavy — the common case)
 *   - substring containment either way (medium — "GitHub Enterprise" ⊃ "github")
 *   - Jaccard overlap of tokens    (fallback — multi-word issuers)
 */
export function scoreMatch(host: string, issuer: string, label?: string): number {
  const hTokens = hostTokens(host);
  const iTokens = issuerTokens(issuer, label);
  if (hTokens.length === 0 || iTokens.length === 0) return 0;

  const primary = primaryHostLabel(host);
  const iJoined = iTokens.join("");

  let score = 0;

  // Exact primary-label hit against any issuer token.
  if (primary && iTokens.includes(primary)) score = Math.max(score, 1);
  // Primary label appears as a substring of the joined issuer, or vice-versa.
  if (primary && (iJoined.includes(primary) || primary.includes(iJoined))) {
    score = Math.max(score, 0.9);
  }
  // Any host token appears verbatim as an issuer token.
  for (const t of hTokens) {
    if (iTokens.includes(t)) score = Math.max(score, 0.95);
  }
  // Substring fallback for compound brands ("googlecloud" vs "google").
  const hJoined = hTokens.join("");
  if (hJoined && iJoined && (hJoined.includes(iJoined) || iJoined.includes(hJoined))) {
    score = Math.max(score, 0.75);
  }
  // Jaccard as a floor.
  score = Math.max(score, jaccard(hTokens, iTokens));

  return Math.min(1, score);
}

export interface Rankable {
  issuer: string;
  label?: string;
}

export interface Ranked<T extends Rankable> {
  account: T;
  score: number;
}

/**
 * Rank a list of accounts against a host, filter out matches below
 * `threshold`, and sort strongest-first. Stable order preserved among
 * ties by falling back to the input index.
 */
export function rankMatches<T extends Rankable>(
  host: string,
  accounts: readonly T[],
  threshold = 0.55,
): Ranked<T>[] {
  const scored = accounts.map((a, i) => ({
    account: a,
    score: scoreMatch(host, a.issuer, a.label),
    _i: i,
  }));
  return scored
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score || a._i - b._i)
    .map(({ account, score }) => ({ account, score }));
}

/** Threshold above which a single match should be silently auto-filled. */
export const AUTOFILL_THRESHOLD = 0.85;
