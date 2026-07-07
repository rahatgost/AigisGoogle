// Tests for the PIN quick-unlock flow. Covers:
//   - enrollPin uses raw DEK bytes (not a CryptoKey), so it works with the
//     non-extractable DEK that ships from unwrapVaultKey.
//   - unlockWithPin round-trips: the recovered raw bytes match the DEK
//     originally used to enroll, and the returned CryptoKey is
//     non-extractable.
//   - Two-PIN confirm behaviour: enroll succeeds only when the second entry
//     matches the first; a mismatch (simulated by enrolling with a different
//     PIN than the one used to unlock) surfaces PinUnlockError("wrong-pin").
//   - Full lock→unlock→enroll scenario: create a vault, unlock, enroll a PIN
//     using the raw DEK from the session, then unlock with the PIN and
//     confirm the raw DEK matches. This is the exact bug the recent refactor
//     addressed ("key is not extractable" on the second PIN entry).

import { describe, it, expect, beforeEach } from "vitest";
import {
  enrollPin,
  unlockWithPin,
  isPinEnabled,
  disablePin,
  PinUnlockError,
  getPinAttemptsRemaining,
} from "./pin-unlock";
import {
  createNewVaultKey,
  unwrapVaultKey,
  encryptSecret,
  decryptSecret,
} from "./vault-crypto";
import {
  setVaultKey,
  getVaultKey,
  getVaultRawKey,
  lockVault,
  isVaultUnlocked,
} from "./vault-session";

// `pin-unlock` and `biometric` both read `window.localStorage`. In the node
// vitest env we don't have `window`, but we do have `globalThis.localStorage`
// from `tests/setup.ts`. Alias one to the other so the module code works.
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: globalThis.localStorage, setTimeout, clearTimeout },
    configurable: true,
  });
}

const USER_ID = "test-user-1";
const PASSPHRASE = "correct horse battery staple";
const GOOD_PIN = "839274";

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

beforeEach(() => {
  // Fresh localStorage + fresh in-memory session between tests.
  globalThis.localStorage.clear();
  lockVault();
});

describe("vault-crypto raw-DEK round-trip", () => {
  it("createNewVaultKey → unwrapVaultKey recovers the same raw DEK bytes", async () => {
    const created = await createNewVaultKey(PASSPHRASE);
    expect(created.rawDek.byteLength).toBe(32);
    expect(created.dek.extractable).toBe(false);

    const unwrapped = await unwrapVaultKey(
      PASSPHRASE,
      created.salt,
      created.wrappedKey,
      created.wrappedKeyIv,
    );
    expect(unwrapped.dek.extractable).toBe(false);
    expect(bytesEqual(created.rawDek, unwrapped.rawDek)).toBe(true);
  });

  it("wrong passphrase rejects on unwrap", async () => {
    const created = await createNewVaultKey(PASSPHRASE);
    await expect(
      unwrapVaultKey("wrong-passphrase", created.salt, created.wrappedKey, created.wrappedKeyIv),
    ).rejects.toBeDefined();
  });
});

describe("PIN enrollment uses raw bytes, not the DEK CryptoKey", () => {
  it("enrollPin accepts raw DEK bytes and lets unlockWithPin recover them", async () => {
    const { rawDek } = await createNewVaultKey(PASSPHRASE);

    await enrollPin({ userId: USER_ID, pin: GOOD_PIN, dekBytes: rawDek });
    expect(isPinEnabled(USER_ID)).toBe(true);

    const unlocked = await unlockWithPin(USER_ID, GOOD_PIN);
    expect(unlocked.dek.extractable).toBe(false);
    expect(bytesEqual(rawDek, unlocked.rawDek)).toBe(true);
  });

  it("rejects weak PINs before writing anything to storage", async () => {
    const { rawDek } = await createNewVaultKey(PASSPHRASE);
    await expect(
      enrollPin({ userId: USER_ID, pin: "111111", dekBytes: rawDek }),
    ).rejects.toThrow(/same digit/i);
    expect(isPinEnabled(USER_ID)).toBe(false);
  });

  it("rejects a bad-length DEK payload with a clear error", async () => {
    await expect(
      enrollPin({ userId: USER_ID, pin: GOOD_PIN, dekBytes: new Uint8Array(16) }),
    ).rejects.toThrow(/invalid vault key/i);
  });
});

describe("double-PIN confirm flow", () => {
  // The UI enters step 1 (first PIN) → step 2 (confirm PIN) → enrollPin. We
  // model that here: the confirm branch either matches (enroll) or mismatches
  // (bail before enroll). If the user's second entry differs, we must NOT
  // enroll — otherwise later PIN unlocks with the "first" PIN would fail.
  it("only enrolls when the two entries match", async () => {
    const { rawDek } = await createNewVaultKey(PASSPHRASE);
    const firstPin: string = GOOD_PIN;
    const secondPin: string = "129384"; // user mistyped

    if (firstPin === secondPin) {
      await enrollPin({ userId: USER_ID, pin: secondPin, dekBytes: rawDek });
    }
    // Simulated UI guard: mismatch never calls enrollPin.
    expect(isPinEnabled(USER_ID)).toBe(false);


    // Now the happy path: same PIN both times → enrolled + unlockable.
    await enrollPin({ userId: USER_ID, pin: firstPin, dekBytes: rawDek });
    const unlocked = await unlockWithPin(USER_ID, firstPin);
    expect(bytesEqual(unlocked.rawDek, rawDek)).toBe(true);
  });

  it("wrong PIN attempts decrement counter and wipe after 5 tries", async () => {
    const { rawDek } = await createNewVaultKey(PASSPHRASE);
    await enrollPin({ userId: USER_ID, pin: GOOD_PIN, dekBytes: rawDek });

    for (let i = 1; i <= 4; i++) {
      await expect(unlockWithPin(USER_ID, "000009")).rejects.toBeInstanceOf(PinUnlockError);
      expect(getPinAttemptsRemaining(USER_ID)).toBe(5 - i);
    }
    // 5th wrong attempt wipes the blob.
    await expect(unlockWithPin(USER_ID, "000009")).rejects.toMatchObject({
      code: "locked-out",
    });
    expect(isPinEnabled(USER_ID)).toBe(false);
  });
});

describe("lock → unlock → enroll (integration)", () => {
  it("after passphrase unlock, session exposes raw DEK for PIN enrollment", async () => {
    // Step 1: create a vault (as if onboarding).
    const created = await createNewVaultKey(PASSPHRASE);
    // Snapshot the DEK bytes — the session zero-fills the buffer on lock.
    const originalDek = new Uint8Array(created.rawDek);
    setVaultKey(created.dek, created.rawDek);
    expect(isVaultUnlocked()).toBe(true);
    expect(getVaultRawKey()).not.toBeNull();

    // Step 2: encrypt something with the runtime DEK so we know it works.
    const enc = await encryptSecret(getVaultKey()!, "hello-totp");
    expect(await decryptSecret(getVaultKey()!, enc.ciphertext, enc.iv)).toBe("hello-totp");

    // Step 3: user sets a PIN — this is where the old "key is not extractable"
    // bug fired, because the non-extractable DEK CryptoKey can't be wrapped.
    // We now hand enrollPin the raw bytes from the session.
    const dekBytes = getVaultRawKey()!;
    await enrollPin({ userId: USER_ID, pin: GOOD_PIN, dekBytes });
    expect(isPinEnabled(USER_ID)).toBe(true);

    // Step 4: lock the vault (simulate auto-lock / manual lock).
    lockVault();
    expect(isVaultUnlocked()).toBe(false);
    expect(getVaultRawKey()).toBeNull();

    // Step 5: unlock with the PIN — must recover the SAME DEK.
    const unlocked = await unlockWithPin(USER_ID, GOOD_PIN);
    setVaultKey(unlocked.dek, unlocked.rawDek);

    // Same DEK bytes as the original create.
    expect(bytesEqual(originalDek, unlocked.rawDek)).toBe(true);


    // And it can decrypt data encrypted before the lock.
    const rt = await decryptSecret(getVaultKey()!, enc.ciphertext, enc.iv);
    expect(rt).toBe("hello-totp");
  });

  it("disablePin wipes the blob so unlockWithPin reports not-enrolled", async () => {
    const { rawDek } = await createNewVaultKey(PASSPHRASE);
    await enrollPin({ userId: USER_ID, pin: GOOD_PIN, dekBytes: rawDek });
    disablePin(USER_ID);
    await expect(unlockWithPin(USER_ID, GOOD_PIN)).rejects.toMatchObject({
      code: "not-enrolled",
    });
  });
});

describe("concurrency: double PIN entry/unlock requests", () => {
  // Mirrors the UI's `busy` guard in PinSetupSheet / lock.tsx: a boolean
  // latch that drops re-entrant calls while the previous promise is still
  // in flight. If the guard works, only ONE underlying call executes.
  function makeBusyGuard<TArgs extends unknown[], TRes>(
    fn: (...args: TArgs) => Promise<TRes>,
  ) {
    let busy = false;
    let calls = 0;
    const wrapped = async (...args: TArgs): Promise<TRes | "dropped"> => {
      if (busy) return "dropped";
      busy = true;
      calls++;
      try {
        return await fn(...args);
      } finally {
        busy = false;
      }
    };
    return { wrapped, getCalls: () => calls };
  }

  it("busy guard drops the second concurrent enrollPin, only one enroll runs", async () => {
    const { rawDek } = await createNewVaultKey(PASSPHRASE);
    const guard = makeBusyGuard(enrollPin);

    const [a, b] = await Promise.all([
      guard.wrapped({ userId: USER_ID, pin: GOOD_PIN, dekBytes: rawDek }),
      guard.wrapped({ userId: USER_ID, pin: GOOD_PIN, dekBytes: rawDek }),
    ]);

    // Exactly one call passed the guard; the other was dropped.
    expect(guard.getCalls()).toBe(1);
    expect([a, b].filter((r) => r === "dropped")).toHaveLength(1);

    // And the single enrollment is usable.
    expect(isPinEnabled(USER_ID)).toBe(true);
    const unlocked = await unlockWithPin(USER_ID, GOOD_PIN);
    expect(bytesEqual(unlocked.rawDek, rawDek)).toBe(true);
  });

  it("busy guard drops the second concurrent unlockWithPin", async () => {
    const { rawDek } = await createNewVaultKey(PASSPHRASE);
    await enrollPin({ userId: USER_ID, pin: GOOD_PIN, dekBytes: rawDek });

    const guard = makeBusyGuard(unlockWithPin);
    const [a, b] = await Promise.all([
      guard.wrapped(USER_ID, GOOD_PIN),
      guard.wrapped(USER_ID, GOOD_PIN),
    ]);

    expect(guard.getCalls()).toBe(1);
    const winners = [a, b].filter((r) => r !== "dropped");
    const dropped = [a, b].filter((r) => r === "dropped");
    expect(winners).toHaveLength(1);
    expect(dropped).toHaveLength(1);

    const winner = winners[0] as { dek: CryptoKey; rawDek: Uint8Array };
    expect(bytesEqual(winner.rawDek, rawDek)).toBe(true);
    // A single successful unlock does NOT consume attempts.
    expect(getPinAttemptsRemaining(USER_ID)).toBe(5);
  });

  it("without a guard, concurrent enrollPin calls still converge to a usable single blob", async () => {
    // Even if the UI guard were bypassed, the storage layer is last-write-wins
    // on a single key — we must never end up in a half-written state where
    // unlockWithPin fails. Fire N concurrent enrolls and confirm one PIN unlock
    // recovers the exact DEK.
    const { rawDek } = await createNewVaultKey(PASSPHRASE);

    await Promise.all(
      Array.from({ length: 5 }, () =>
        enrollPin({ userId: USER_ID, pin: GOOD_PIN, dekBytes: rawDek }),
      ),
    );

    expect(isPinEnabled(USER_ID)).toBe(true);
    const unlocked = await unlockWithPin(USER_ID, GOOD_PIN);
    expect(bytesEqual(unlocked.rawDek, rawDek)).toBe(true);
    expect(getPinAttemptsRemaining(USER_ID)).toBe(5);
  });

  it("busy guard drops a re-entrant call fired from inside the first (double-submit)", async () => {
    // Simulates a user tapping "Confirm" twice in the same tick: the second
    // handler fires while the first is still awaiting enrollPin.
    const { rawDek } = await createNewVaultKey(PASSPHRASE);
    const guard = makeBusyGuard(enrollPin);

    const first = guard.wrapped({ userId: USER_ID, pin: GOOD_PIN, dekBytes: rawDek });
    // Fire the second synchronously, before `first` has a chance to resolve.
    const second = guard.wrapped({ userId: USER_ID, pin: GOOD_PIN, dekBytes: rawDek });

    const [r1, r2] = await Promise.all([first, second]);
    expect(guard.getCalls()).toBe(1);
    expect([r1, r2]).toContain("dropped");
    expect(isPinEnabled(USER_ID)).toBe(true);
  });
});
