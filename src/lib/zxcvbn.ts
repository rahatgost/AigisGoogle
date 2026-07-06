// Lazy-loaded zxcvbn wrapper. The library ships ~140KB of dictionaries so we
// keep it out of the initial bundle and load it on demand the first time a
// passphrase field asks for a score.

/** The four attack scenarios zxcvbn models. Keys are stable across versions. */
export type CrackTimeKey =
  | "onlineThrottling100PerHour"
  | "onlineNoThrottling10PerSecond"
  | "offlineSlowHashing1e4PerSecond"
  | "offlineFastHashing1e10PerSecond";

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

/** The number of filled segments (out of 4) for a given score. */
export type StrengthSegments = readonly [boolean, boolean, boolean, boolean];

/** Derive the four-segment strength bar from a numeric score. */
export function scoreToSegments(score: number): StrengthSegments {
  const s = Math.max(0, Math.min(4, Math.floor(score)));
  return [0, 1, 2, 3].map((i) => i < s) as unknown as StrengthSegments;
}

const CRACK_KEYS: readonly CrackTimeKey[] = [
  "onlineThrottling100PerHour",
  "onlineNoThrottling10PerSecond",
  "offlineSlowHashing1e4PerSecond",
  "offlineFastHashing1e10PerSecond",
];

// zxcvbn-ts types crack-time seconds as `number | string` (returns the string
// "Infinity" for astronomical values). Coerce to a finite number so downstream
// code has a single type to reason about.
function toSeconds(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  }
  return 0;
}

export function mapCrackTimesSeconds(raw: Record<string, unknown> | undefined | null): CrackTimesSeconds {
  const src = raw ?? {};
  const out = {} as CrackTimesSeconds;
  for (const k of CRACK_KEYS) out[k] = toSeconds(src[k]);
  return out;
}

export function mapCrackTimesDisplay(raw: Record<string, unknown> | undefined | null): CrackTimesDisplay {
  const src = raw ?? {};
  const out = {} as CrackTimesDisplay;
  for (const k of CRACK_KEYS) out[k] = typeof src[k] === "string" ? (src[k] as string) : String(src[k] ?? "");
  return out;
}

interface RawCheckResult {
  score: number;
  feedback: { warning?: string | null; suggestions?: string[] };
  crackTimesSeconds?: Record<string, unknown>;
  crackTimesDisplay?: Record<string, unknown>;
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
  onlineThrottling100PerHour: 0,
  onlineNoThrottling10PerSecond: 0,
  offlineSlowHashing1e4PerSecond: 0,
  offlineFastHashing1e10PerSecond: 0,
};
const EMPTY_CRACK_DISPLAY: CrackTimesDisplay = {
  onlineThrottling100PerHour: "less than a second",
  onlineNoThrottling10PerSecond: "less than a second",
  offlineSlowHashing1e4PerSecond: "less than a second",
  offlineFastHashing1e10PerSecond: "less than a second",
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
    crackTimesSeconds: mapCrackTimesSeconds(result.crackTimesSeconds),
    crackTimesDisplay: mapCrackTimesDisplay(result.crackTimesDisplay),
  };
}
