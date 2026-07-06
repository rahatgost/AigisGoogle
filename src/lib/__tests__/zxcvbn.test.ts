import { describe, expect, it } from "vitest";
import {
  evaluatePassphrase,
  mapCrackTimesDisplay,
  mapCrackTimesSeconds,
  scoreToSegments,
  type CrackTimeKey,
} from "@/lib/zxcvbn";

const KEYS: readonly CrackTimeKey[] = [
  "onlineThrottling100PerHour",
  "onlineNoThrottling10PerSecond",
  "offlineSlowHashing1e4PerSecond",
  "offlineFastHashing1e10PerSecond",
];

describe("scoreToSegments", () => {
  it("fills exactly N of 4 segments for scores 0..4", () => {
    expect(scoreToSegments(0)).toEqual([false, false, false, false]);
    expect(scoreToSegments(1)).toEqual([true, false, false, false]);
    expect(scoreToSegments(2)).toEqual([true, true, false, false]);
    expect(scoreToSegments(3)).toEqual([true, true, true, false]);
    expect(scoreToSegments(4)).toEqual([true, true, true, true]);
  });

  it("clamps out-of-range and non-integer inputs", () => {
    expect(scoreToSegments(-5)).toEqual([false, false, false, false]);
    expect(scoreToSegments(99)).toEqual([true, true, true, true]);
    expect(scoreToSegments(2.9)).toEqual([true, true, false, false]);
  });

  it("returns a tuple of length 4", () => {
    const s = scoreToSegments(3);
    expect(s).toHaveLength(4);
    expect(s.every((v) => typeof v === "boolean")).toBe(true);
  });
});

describe("mapCrackTimesSeconds", () => {
  it("maps every canonical key as a number", () => {
    const out = mapCrackTimesSeconds({
      onlineThrottling100PerHour: 12,
      onlineNoThrottling10PerSecond: 0.5,
      offlineSlowHashing1e4PerSecond: 1000,
      offlineFastHashing1e10PerSecond: 1e-6,
    });
    for (const k of KEYS) expect(typeof out[k]).toBe("number");
    expect(out.onlineThrottling100PerHour).toBe(12);
    expect(out.offlineFastHashing1e10PerSecond).toBeCloseTo(1e-6);
  });

  it("coerces string numerics and treats 'Infinity' / non-finite as +Infinity", () => {
    const out = mapCrackTimesSeconds({
      onlineThrottling100PerHour: "42",
      onlineNoThrottling10PerSecond: "Infinity",
      offlineSlowHashing1e4PerSecond: Number.POSITIVE_INFINITY,
      offlineFastHashing1e10PerSecond: "not-a-number",
    });
    expect(out.onlineThrottling100PerHour).toBe(42);
    expect(out.onlineNoThrottling10PerSecond).toBe(Number.POSITIVE_INFINITY);
    expect(out.offlineSlowHashing1e4PerSecond).toBe(Number.POSITIVE_INFINITY);
    expect(out.offlineFastHashing1e10PerSecond).toBe(Number.POSITIVE_INFINITY);
  });

  it("defaults missing keys to 0 and tolerates null/undefined input", () => {
    expect(mapCrackTimesSeconds(null)).toEqual({
      onlineThrottling100PerHour: 0,
      onlineNoThrottling10PerSecond: 0,
      offlineSlowHashing1e4PerSecond: 0,
      offlineFastHashing1e10PerSecond: 0,
    });
    expect(mapCrackTimesSeconds(undefined)).toEqual(mapCrackTimesSeconds(null));
    const partial = mapCrackTimesSeconds({ onlineThrottling100PerHour: 7 });
    expect(partial.onlineThrottling100PerHour).toBe(7);
    expect(partial.offlineFastHashing1e10PerSecond).toBe(0);
  });
});

describe("mapCrackTimesDisplay", () => {
  it("passes through string labels for every key", () => {
    const out = mapCrackTimesDisplay({
      onlineThrottling100PerHour: "centuries",
      onlineNoThrottling10PerSecond: "3 hours",
      offlineSlowHashing1e4PerSecond: "12 minutes",
      offlineFastHashing1e10PerSecond: "less than a second",
    });
    expect(out.onlineThrottling100PerHour).toBe("centuries");
    expect(out.offlineFastHashing1e10PerSecond).toBe("less than a second");
    for (const k of KEYS) expect(typeof out[k]).toBe("string");
  });

  it("stringifies non-string values and handles missing input", () => {
    const out = mapCrackTimesDisplay({ onlineThrottling100PerHour: 5 });
    expect(out.onlineThrottling100PerHour).toBe("5");
    expect(out.offlineSlowHashing1e4PerSecond).toBe("");
    expect(mapCrackTimesDisplay(null).offlineFastHashing1e10PerSecond).toBe("");
  });
});

describe("evaluatePassphrase", () => {
  it("returns a zeroed shape for the empty string without loading zxcvbn", async () => {
    const r = await evaluatePassphrase("");
    expect(r.score).toBe(0);
    expect(r.warning).toBe("");
    expect(r.suggestions).toEqual([]);
    for (const k of KEYS) {
      expect(typeof r.crackTimesSeconds[k]).toBe("number");
      expect(typeof r.crackTimesDisplay[k]).toBe("string");
    }
  });

  it("scores an obviously weak passphrase low and a long unique one high", async () => {
    const weak = await evaluatePassphrase("password");
    const strong = await evaluatePassphrase(
      "correct horse battery staple lantern quartz",
    );
    expect(weak.score).toBeLessThanOrEqual(1);
    expect(strong.score).toBeGreaterThanOrEqual(3);
    // Strong passphrase must take strictly longer to crack than a dictionary word
    // under the same attack scenario.
    expect(strong.crackTimesSeconds.offlineFastHashing1e10PerSecond).toBeGreaterThan(
      weak.crackTimesSeconds.offlineFastHashing1e10PerSecond,
    );
  }, 15_000);

  it("populates every canonical crack-time key with the correct type", async () => {
    const r = await evaluatePassphrase("Tr0ub4dor&3");
    for (const k of KEYS) {
      expect(r.crackTimesSeconds).toHaveProperty(k);
      expect(typeof r.crackTimesSeconds[k]).toBe("number");
      expect(typeof r.crackTimesDisplay[k]).toBe("string");
      expect(r.crackTimesDisplay[k].length).toBeGreaterThan(0);
    }
  }, 15_000);

  it("derived segments match the reported score", async () => {
    const r = await evaluatePassphrase("hunter2");
    const seg = scoreToSegments(r.score);
    expect(seg.filter(Boolean).length).toBe(r.score);
  }, 15_000);
});
