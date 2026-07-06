import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  DEFAULT_NONCE_TTL_MS,
  serializeForSign,
  signNonce,
  verifyNonce,
  type NonceMaterial,
} from "@/lib/push-nonce";

const SECRET = "test-secret-do-not-use-in-prod";

function material(overrides: Partial<NonceMaterial> = {}): NonceMaterial {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    action: "approve_login",
    expiresAt: Date.now() + DEFAULT_NONCE_TTL_MS,
    payload: { device: "Chrome on macOS", ip: "1.2.3.4" },
    ...overrides,
  };
}

describe("canonicalJson", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { b: 1, a: 2 }, y: [3, 1, 2] })).toBe(
      '{"y":[3,1,2],"z":{"a":2,"b":1}}',
    );
  });
  it("strips undefined fields", () => {
    expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });
  it("handles primitives and null", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("hi")).toBe('"hi"');
  });
});

describe("serializeForSign", () => {
  it("is stable across payload key order", () => {
    const a = serializeForSign(material({ payload: { a: 1, b: 2 } }));
    const b = serializeForSign(material({ payload: { b: 2, a: 1 } }));
    expect(a).toBe(b);
  });
  it("changes when any field changes", () => {
    const base = serializeForSign(material());
    expect(base).not.toBe(serializeForSign(material({ action: "different" })));
    expect(base).not.toBe(serializeForSign(material({ userId: "other" })));
    expect(base).not.toBe(
      serializeForSign(material({ payload: { device: "changed" } })),
    );
  });
});

describe("signNonce / verifyNonce", () => {
  it("round-trips a valid signature", async () => {
    const m = material();
    const sig = await signNonce(m, SECRET);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(await verifyNonce(m, sig, SECRET)).toEqual({ ok: true });
  });

  it("rejects when the payload was tampered with after signing", async () => {
    const m = material();
    const sig = await signNonce(m, SECRET);
    const tampered = { ...m, payload: { device: "attacker device" } };
    expect(await verifyNonce(tampered, sig, SECRET)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects when action, user, or id changes", async () => {
    const m = material();
    const sig = await signNonce(m, SECRET);
    for (const patch of [
      { action: "approve_export" },
      { userId: "33333333-3333-3333-3333-333333333333" },
      { id: "99999999-9999-9999-9999-999999999999" },
    ] as const) {
      const res = await verifyNonce({ ...m, ...patch }, sig, SECRET);
      expect(res).toEqual({ ok: false, reason: "bad_signature" });
    }
  });

  it("rejects when signed with a different secret", async () => {
    const m = material();
    const sig = await signNonce(m, SECRET);
    expect(await verifyNonce(m, sig, "other-secret")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects when expired", async () => {
    const past = Date.now() - 1000;
    const m = material({ expiresAt: past });
    const sig = await signNonce(m, SECRET);
    expect(await verifyNonce(m, sig, SECRET)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("respects an injected clock", async () => {
    const m = material({ expiresAt: 1_000_000 });
    const sig = await signNonce(m, SECRET);
    expect(await verifyNonce(m, sig, SECRET, { now: 999_999 })).toEqual({ ok: true });
    expect(await verifyNonce(m, sig, SECRET, { now: 1_000_001 })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses to sign or verify without a secret", async () => {
    const m = material();
    await expect(signNonce(m, "")).rejects.toThrow(/secret/);
    expect(await verifyNonce(m, "anything", "")).toEqual({
      ok: false,
      reason: "missing_secret",
    });
  });

  it("uses constant-time comparison for signatures", async () => {
    // Not a real timing test — just proves two different-but-same-length
    // signatures both cleanly return `bad_signature` without throwing.
    const m = material();
    const sig = await signNonce(m, SECRET);
    const tampered = "A".repeat(sig.length);
    expect(await verifyNonce(m, tampered, SECRET)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});
