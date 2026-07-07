// Regression test for `ext_bridge_spoof` (agent_security scan).
//
// Before the fix, `isExtensionInstalled()` returned true for ANY extension
// ID stamped onto <html data-aegis-extension-id="…">, so any installed
// browser extension could hijack the sync channel. The fix pins trust to a
// hardcoded allowlist populated from `VITE_EXT_TRUSTED_IDS` (+ published
// IDs) with an explicit `VITE_EXT_ALLOW_UNPACKED` dev opt-in. This suite
// pins that behaviour so no future change silently re-opens the hole.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TRUSTED = "trustedaaaaaaaaaaaaaaaaaaaaaaaaa";
const ATTACKER = "attackerbbbbbbbbbbbbbbbbbbbbbbbb";

interface FakeDoc { documentElement: { dataset: Record<string, string> } }
const fakeDoc: FakeDoc = { documentElement: { dataset: {} } };

beforeEach(() => {
  fakeDoc.documentElement.dataset = {};
  (globalThis as { document?: FakeDoc }).document = fakeDoc;
});

async function loadBridge(env: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("VITE_EXT_TRUSTED_IDS", env.VITE_EXT_TRUSTED_IDS ?? "");
  vi.stubEnv("VITE_EXT_ALLOW_UNPACKED", env.VITE_EXT_ALLOW_UNPACKED ?? "");
  if (env.dom) fakeDoc.documentElement.dataset.aegisExtensionId = env.dom;
  return await import("../extension-bridge");
}

afterEach(() => {
  delete (globalThis as { document?: FakeDoc }).document;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("extension-bridge trust allowlist", () => {
  it("refuses an ID that isn't in the allowlist", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = await loadBridge({
      VITE_EXT_TRUSTED_IDS: TRUSTED,
      dom: ATTACKER,
    });
    expect(bridge.isExtensionInstalled()).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("accepts an ID that is in the allowlist", async () => {
    const bridge = await loadBridge({
      VITE_EXT_TRUSTED_IDS: `${TRUSTED},other`,
      dom: TRUSTED,
    });
    expect(bridge.isExtensionInstalled()).toBe(true);
    expect(bridge.__testing.isTrusted(TRUSTED)).toBe(true);
    expect(bridge.__testing.isTrusted(ATTACKER)).toBe(false);
  });

  it("returns false when no ID is present", async () => {
    const bridge = await loadBridge({ VITE_EXT_TRUSTED_IDS: TRUSTED });
    expect(bridge.isExtensionInstalled()).toBe(false);
  });

  it("refuses everything when the allowlist is empty (no unpacked opt-in)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = await loadBridge({ dom: ATTACKER });
    expect(bridge.isExtensionInstalled()).toBe(false);
  });

  it("allows unpacked dev IDs only with VITE_EXT_ALLOW_UNPACKED=true and warns loudly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = await loadBridge({
      VITE_EXT_ALLOW_UNPACKED: "true",
      dom: "somelocaldevextensionidxxxxxxxxxx",
    });
    expect(bridge.isExtensionInstalled()).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("VITE_EXT_ALLOW_UNPACKED=true"));
  });

  it("does NOT sync to an untrusted extension (syncVaultToExtension returns no_id)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = await loadBridge({
      VITE_EXT_TRUSTED_IDS: TRUSTED,
      dom: ATTACKER,
    });
    // Fake chrome runtime so we can assert sendMessage is never invoked.
    const sendMessage = vi.fn();
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    try {
      const res = await bridge.syncVaultToExtension({ userId: "u1", accounts: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("no_id");
      expect(sendMessage).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as { chrome?: unknown }).chrome;
    }
  });
});
