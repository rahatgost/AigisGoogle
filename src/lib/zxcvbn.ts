// Lazy-loaded zxcvbn wrapper. The library ships ~140KB of dictionaries so we
// keep it out of the initial bundle and load it on demand the first time a
// passphrase field asks for a score.

/** The four attack scenarios zxcvbn-ts models. Keys are stable across v3+. */
export type CrackTimeKey =
  | "onlineThrottlingXPerHour"
  | "onlineNoThrottlingXPerSecond"
  | "offlineSlowHashingXPerSecond"
  | "offlineFastHashingXPerSecond";

export type CrackTimesSeconds = Record<CrackTimeKey, number>;
export type CrackTimesDisplay = Record<CrackTimeKey, string>;

export interface PassphraseScore {
  /** 0 (weakest) – 4 (strongest). */
  score: 0 | 1 | 2 | 3 | 4;
  warning: string;
  suggestions: string[];
  crackTimesSeconds: CrackTimesSeconds;
  crackTimesDisplay: CrackTimesDisplay;
}

/** Filled state for the four-segment strength bar. */
export type StrengthSegments = readonly [boolean, boolean, boolean, boolean];

/** Derive the four-segment strength bar from a numeric score. */
export function scoreToSegments(score: number): StrengthSegments {
  const s = Math.max(0, Math.min(4, Math.floor(score)));
  return [0, 1, 2, 3].map((i) => i < s) as unknown as StrengthSegments;
}

export const CRACK_TIME_KEYS: readonly CrackTimeKey[] = [
  "onlineThrottlingXPerHour",
  "onlineNoThrottlingXPerSecond",
  "offlineSlowHashingXPerSecond",
  "offlineFastHashingXPerSecond",
];

// zxcvbn-ts reports crack-time seconds as a number, but historically also as
// the string "Infinity" for astronomical values. Coerce to a finite number
// (or +Infinity) so downstream code has a single type to reason about.
function toSeconds(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  }
  return 0;
}

interface RawCrackTimeEntry {
  seconds?: unknown;
  display?: unknown;
}

/** Map the raw `crackTimes` object into a flat `{ key -> seconds }` record. */
export function mapCrackTimesSeconds(
  raw: Partial<Record<string, RawCrackTimeEntry>> | undefined | null,
): CrackTimesSeconds {
  const src = raw ?? {};
  const out = {} as CrackTimesSeconds;
  for (const k of CRACK_TIME_KEYS) out[k] = toSeconds(src[k]?.seconds);
  return out;
}

/** Map the raw `crackTimes` object into a flat `{ key -> display }` record. */
export function mapCrackTimesDisplay(
  raw: Partial<Record<string, RawCrackTimeEntry>> | undefined | null,
): CrackTimesDisplay {
  const src = raw ?? {};
  const out = {} as CrackTimesDisplay;
  for (const k of CRACK_TIME_KEYS) {
    const d = src[k]?.display;
    out[k] = typeof d === "string" ? d : d == null ? "" : String(d);
  }
  return out;
}

interface RawCheckResult {
  score: number;
  feedback: { warning?: string | null; suggestions?: string[] };
  crackTimes?: Partial<Record<string, RawCrackTimeEntry>>;
}

let factoryPromise: Promise<{ check: (pw: string) => RawCheckResult }> | null = null;

async function getFactory() {
  if (factoryPromise) return factoryPromise;
  factoryPromise = (async () => {
    const [core, common, en] = await Promise.all([
      import("@zxcvbn-ts/core"),
      import("@zxcvbn-ts/language-common"),
      import("@zxcvbn-ts/language-en"),
    ]);
    return new core.ZxcvbnFactory({
      translations: en.translations,
      graphs: common.adjacencyGraphs,
      dictionary: {
        ...common.dictionary,
        ...en.dictionary,
      },
    });
  })();
  return factoryPromise;
}

/** Warm the dictionaries in the background — cheap to call multiple times. */
export function preloadZxcvbn() {
  void getFactory();
}

const EMPTY_CRACK_SECONDS: CrackTimesSeconds = {
  onlineThrottlingXPerHour: 0,
  onlineNoThrottlingXPerSecond: 0,
  offlineSlowHashingXPerSecond: 0,
  offlineFastHashingXPerSecond: 0,
};
const EMPTY_CRACK_DISPLAY: CrackTimesDisplay = {
  onlineThrottlingXPerHour: "less than a second",
  onlineNoThrottlingXPerSecond: "less than a second",
  offlineSlowHashingXPerSecond: "less than a second",
  offlineFastHashingXPerSecond: "less than a second",
};

export async function evaluatePassphrase(pw: string): Promise<PassphraseScore> {
  if (!pw) {
    return {
      score: 0,
      warning: "",
      suggestions: [],
      crackTimesSeconds: { ...EMPTY_CRACK_SECONDS },
      crackTimesDisplay: { ...EMPTY_CRACK_DISPLAY },
    };
  }
  const factory = await getFactory();
  const result = factory.check(pw);
  return {
    score: Math.max(0, Math.min(4, result.score)) as 0 | 1 | 2 | 3 | 4,
    warning: result.feedback.warning ?? "",
    suggestions: result.feedback.suggestions ?? [],
    crackTimesSeconds: mapCrackTimesSeconds(result.crackTimes),
    crackTimesDisplay: mapCrackTimesDisplay(result.crackTimes),
  };
}
