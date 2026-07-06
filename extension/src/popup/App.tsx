/**
 * Popup shell (Phase 10.1).
 *
 * This is the reachability check that all three vault primitives —
 * `vault-crypto`, `vault-accounts`, `biometric` — resolve, import, and
 * link correctly through the extension bundler. The actual unlock UI
 * lands in Phase 10.2 alongside the autofill flow.
 *
 * The imports below are intentionally value imports (not `import type`)
 * so the bundler proves the modules are compatible with the extension
 * runtime, not just the web app's SSR runtime.
 */

/// <reference types="chrome" />

import { useEffect, useState } from "react";
import { VAULT_CRYPTO_VERSION } from "@/lib/vault-crypto";
import { isBiometricSupported } from "@/lib/biometric";

// Touch vault-accounts so bundler resolution is proven at build time
// without executing any Supabase network call in the popup shell.
import * as vaultAccounts from "@/lib/vault-accounts";
void vaultAccounts;

interface SwStatus {
  ok: boolean;
  version?: string;
}

export function App() {
  const [sw, setSw] = useState<SwStatus | null>(null);
  const [bio, setBio] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: "GET_VERSION" });
        if (alive) setSw({ ok: Boolean(res?.ok), version: res?.version });
      } catch {
        if (alive) setSw({ ok: false });
      }
    })();

    void isBiometricSupported().then((v) => {
      if (alive) setBio(v);
    });

    return () => {
      alive = false;
    };
  }, []);

  const webAppUrl = "https://hug-machine-maker.lovable.app/vault";

  return (
    <div className="wrap">
      <div className="row">
        <h1>Aegis</h1>
        <span className="pill">v{chrome.runtime.getManifest().version}</span>
      </div>

      <p className="muted">
        Zero-knowledge TOTP vault. Sign in on the web app to sync accounts to
        this device; codes stay encrypted end-to-end.
      </p>

      <div className="divider" />

      <div className="status">
        <span className={`dot ${sw?.ok ? "" : "warn"}`} />
        Service worker{" "}
        {sw === null ? "…" : sw.ok ? `ready (crypto v${VAULT_CRYPTO_VERSION})` : "unreachable"}
      </div>
      <div className="status">
        <span className={`dot ${bio ? "" : "warn"}`} />
        Biometric unlock {bio === null ? "…" : bio ? "available" : "unavailable"}
      </div>

      <div className="divider" />

      <div className="row">
        <span className="muted">Autofill lands in the next release.</span>
        <button
          className="btn"
          onClick={() => {
            void chrome.tabs.create({ url: webAppUrl });
          }}
        >
          Open vault
        </button>
      </div>
    </div>
  );
}
