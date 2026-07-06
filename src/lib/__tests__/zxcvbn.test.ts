import { describe, expect, it } from "vitest";
import {
  CRACK_TIME_KEYS,
  evaluatePassphrase,
  mapCrackTimesDisplay,
  mapCrackTimesSeconds,
  scoreToSegments,
  type CrackTimeKey,
} from "@/lib/zxcvbn";

const KEYS: readonly CrackTimeKey[] = CRACK_TIME_KEYS;

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

  it("returns a length-4 tuple of booleans", () => {
    const s = scoreToSegments(3);
    expect(s).toHaveLength(4);
    expect(s.every((v) => typeof v === "boolean")).toBe(true);
  });
});

describe("mapCrackTimesSeconds", () => {
  it("extracts a number from each canonical entry", () => {
    const out = mapCrackTimesSeconds({
      onlineThrottlingXPerHour: { seconds: 12, display: "a" },
      onlineNoThrottlingXPerSecond: { seconds: 0.5, display: "b" },
      offlineSlowHashingXPerSecond: { seconds: 1000, display: "c" },
      offlineFastHashingXPerSecond: { seconds: 1e-6, display: "d" },
    });
    for (const k of KEYS) expect(typeof out[k]).toBe("number");
    expect(out.onlineThrottlingXPerHour).toBe(12);
    expect(out.offlineFastHashingXPerSecond).toBeCloseTo(1e-6);
  });

  it("coerces string numerics and treats 'Infinity'/NaN as +Infinity", () => {
    const out = mapCrackTimesSeconds({
      onlineThrottlingXPerHour: { seconds: "42" },
      onlineNoThrottlingXPerSecond: { seconds: "Infinity" },
      offlineSlowHashingXPerSecond: { seconds: Number.POSITIVE_INFINITY },
      offlineFastHashingXPerSecond: { seconds: "not-a-number" },
    });
    expect(out.onlineThrottlingXPerHour).toBe(42);
    expect(out.onlineNoThrottlingXPerSecond).toBe(Number.POSITIVE_INFINITY);
    expect(out.offlineSlowHashingXPerSecond).toBe(Number.POSITIVE_INFINITY);
    expect(out.offlineFastHashingXPerSecond).toBe(Number.POSITIVE_INFINITY);
  });

  it("defaults missing keys to 0 and tolerates null/undefined input", () => {
    expect(mapCrackTimesSeconds(null)).toEqual({
      onlineThrottlingXPerHour: 0,
      onlineNoThrottlingXPerSecond: 0,
      offlineSlowHashingXPerSecond: 0,
      offlineFastHashingXPerSecond: 0,
    });
    expect(mapCrackTimesSeconds(undefined)).toEqual(mapCrackTimesSeconds(null));
    const partial = mapCrackTimesSeconds({
      onlineThrottlingXPerHour: { seconds: 7 },
    });
    expect(partial.onlineThrottlingXPerHour).toBe(7);
    expect(partial.offlineFastHashingXPerSecond).toBe(0);
  });
});

describe("mapCrackTimesDisplay", () => {
  it("passes through the display string for every canonical key", () => {
    const out = mapCrackTimesDisplay({
      onlineThrottlingXPerHour: { display: "centuries" },
      onlineNoThrottlingXPerSecond: { display: "3 hours" },
      offlineSlowHashingXPerSecond: { display: "12 minutes" },
      offlineFastHashingXPerSecond: { display: "less than a second" },
    });
    expect(out.onlineThrottlingXPerHour).toBe("centuries");
    expect(out.offlineFastHashingXPerSecond).toBe("less than a second");
    for (const k of KEYS) expect(typeof out[k]).toBe("string");
  });

  it("stringifies non-string display values and defaults missing entries", () => {
    const out = mapCrackTimesDisplay({
      onlineThrottlingXPerHour: { display: 5 as unknown as string },
    });
    expect(out.onlineThrottlingXPerHour).toBe("5");
    expect(out.offlineSlowHashingXPerSecond).toBe("");
    expect(mapCrackTimesDisplay(null).offlineFastHashingXPerSecond).toBe("");
  });
});

describe("evaluatePassphrase", () => {
  it("returns a fully-populated zeroed shape for the empty string", async () => {
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
    expect(
      strong.crackTimesSeconds.offlineFastHashingXPerSecond,
    ).toBeGreaterThan(weak.crackTimesSeconds.offlineFastHashingXPerSecond);
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
