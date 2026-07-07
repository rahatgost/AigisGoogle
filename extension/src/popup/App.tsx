/**
 * Popup (v0.4).
 *
 * - Shows locked/unlocked state and, when unlocked, matches for the
 *   current tab.
 * - New in 0.4: search across the full vault, live TOTP codes with
 *   countdown, one-click copy of the visible code, and a "browse all"
 *   view when there is no host match.
 */

/// <reference types="chrome" />

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeHost } from "@/lib/domain-match";
import * as vaultAccounts from "@/lib/vault-accounts";
void vaultAccounts;

interface Match {
  id: string;
  issuer: string;
  label: string;
  score?: number;
  period?: number;
  otp_type?: string;
}

interface State {
  unlocked: boolean;
  accountCount: number;
  expiresAt: number;
}

function send<T = unknown>(msg: unknown): Promise<T> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => resolve(res as T));
    } catch {
      resolve({} as T);
    }
  });
}

function prettyHost(host: string): string {
  if (!host) return "";
  const cleaned = host
    .replace(/\.lovable\.(app|dev)$/i, "")
    .replace(/\.vercel\.app$/i, "")
    .replace(/\.netlify\.app$/i, "")
    .replace(/^id-preview--[^.]+--/i, "")
    .replace(/^[a-f0-9-]{36}--/i, "");
  return cleaned || host;
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3 4 6v6c0 4.5 3.2 8.4 8 9 4.8-.6 8-4.5 8-9V6l-8-3Z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

declare const __AEGIS_APP_URL__: string;
const APP_URL: string =
  typeof __AEGIS_APP_URL__ === "string" && __AEGIS_APP_URL__.length > 0
    ? __AEGIS_APP_URL__
    : "https://hug-machine-maker.lovable.app";

/**
 * Live TOTP row: fetches current code from SW, refreshes at each
 * period boundary, shows a countdown ring, and offers Fill/Copy.
 */
function LiveCodeRow({
  account,
  tabId,
  onCopy,
  onFill,
  copied,
}: {
  account: Match;
  tabId: number | null;
  onCopy: (a: Match, code: string) => void;
  onFill: (a: Match) => void;
  copied: boolean;
}) {
  const period = account.period ?? 30;
  const [code, setCode] = useState<string>("");
  const [remaining, setRemaining] = useState<number>(period);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const res = await send<{ ok: boolean; code?: string }>({
        type: "GET_CODE",
        accountId: account.id,
      });
      if (!cancelled && mounted.current && res?.ok && res.code) setCode(res.code);
    }
    void refresh();
    // Poll countdown every 500ms; refresh code at boundary.
    const iv = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const r = period - (now % period);
      setRemaining(r);
      if (r === period) void refresh();
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [account.id, period]);

  const pct = Math.max(0, Math.min(1, remaining / period));
  const circ = 2 * Math.PI * 9;
  const dash = circ * pct;
  const ringColor = remaining <= 5 ? "var(--danger)" : "var(--charcoal)";

  const displayCode = code
    ? account.otp_type === "steam"
      ? code
      : code.length > 3
        ? `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`
        : code
    : "••••••";

  return (
    <div className="matchRow">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="issuer" title={account.issuer}>
          {account.issuer || "Untitled"}
        </div>
        {account.label && (
          <div className="label" title={account.label}>
            {account.label}
          </div>
        )}
        <div
          className="code"
          onClick={() => code && onCopy(account, code)}
          title="Click code to copy"
        >
          {displayCode}
        </div>
      </div>
      <div className="actions">
        <div className="ring" aria-label={`${remaining}s remaining`}>
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" className="ring-track" />
            <circle
              cx="12"
              cy="12"
              r="9"
              className="ring-fill"
              style={{
                strokeDasharray: `${dash} ${circ}`,
                stroke: ringColor,
              }}
            />
          </svg>
          <span className="ring-num">{remaining}</span>
        </div>
        <button
          className="btn ghost small"
          onClick={() => code && onCopy(account, code)}
          disabled={!code}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {tabId != null && (
          <button
            className="btn small"
            onClick={() => onFill(account)}
            disabled={!code}
          >
            Fill
          </button>
        )}
      </div>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [tabHost, setTabHost] = useState<string>("");
  const [tabId, setTabId] = useState<number | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [allAccounts, setAllAccounts] = useState<Match[] | null>(null);
  const [query, setQuery] = useState<string>("");
  const [showAll, setShowAll] = useState<boolean>(false);
  const [copied, setCopied] = useState<string | null>(null);

  const webAppUrl = `${APP_URL.replace(/\/$/, "")}/vault`;

  useEffect(() => {
    let alive = true;
    void send<State & { ok: boolean }>({ type: "GET_STATE" }).then((res) => {
      if (alive && res?.ok) {
        setState({
          unlocked: !!res.unlocked,
          accountCount: res.accountCount ?? 0,
          expiresAt: res.expiresAt ?? 0,
        });
      }
    });
    void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const t = tabs[0];
      const url = t?.url ?? "";
      if (alive) {
        setTabId(t?.id ?? null);
        setTabHost(normalizeHost(url));
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!state?.unlocked || !tabHost) return;
    let alive = true;
    void send<{ ok: boolean; matches?: Match[] }>({
      type: "MATCH_HOST",
      host: tabHost,
    }).then((res) => {
      if (alive && res?.ok) setMatches(res.matches ?? []);
    });
    return () => {
      alive = false;
    };
  }, [state?.unlocked, tabHost]);

  // Auto-switch to "all" view when there are no matches on this host.
  useEffect(() => {
    if (matches && matches.length === 0) setShowAll(true);
  }, [matches]);

  useEffect(() => {
    if (!state?.unlocked || !showAll) return;
    let alive = true;
    void send<{ ok: boolean; accounts?: Match[] }>({
      type: "LIST_ACCOUNTS",
      query,
    }).then((res) => {
      if (alive && res?.ok) setAllAccounts(res.accounts ?? []);
    });
    return () => {
      alive = false;
    };
  }, [state?.unlocked, showAll, query]);

  const hostLabel = useMemo(() => prettyHost(tabHost), [tabHost]);
  const version = chrome.runtime.getManifest().version;

  async function fill(m: Match) {
    if (tabId == null) return;
    const res = await send<{ ok: boolean; code?: string; error?: string }>({
      type: "GET_CODE",
      accountId: m.id,
    });
    if (!res.ok || !res.code) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        args: [res.code],
        func: (code: string) => {
          const el = document.activeElement as HTMLInputElement | null;
          if (!el || el.tagName !== "INPUT") return;
          const setter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(el),
            "value",
          )?.set;
          setter ? setter.call(el, code) : (el.value = code);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        },
      });
      window.close();
    } catch {
      await copy(m, res.code);
    }
  }

  async function copy(m: Match, precomputed?: string) {
    let code = precomputed;
    if (!code) {
      const res = await send<{ ok: boolean; code?: string }>({
        type: "GET_CODE",
        accountId: m.id,
      });
      if (!res.ok || !res.code) return;
      code = res.code;
    }
    await navigator.clipboard.writeText(code).catch(() => undefined);
    if (tabId != null) {
      void send({ type: "CLIPBOARD_ARMED", tabId, accountId: m.id });
    }
    setCopied(m.id);
    setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1500);
  }

  const visibleList = showAll ? allAccounts : matches;

  return (
    <div className="wrap">
      <div className="brand">
        <div className="brand-left">
          <span className="brand-mark">
            <ShieldGlyph />
          </span>
          <span className="brand-word">Aegis</span>
        </div>
        <span className="pill">v{version}</span>
      </div>

      {state === null ? (
        <div className="headline">
          <h1>Connecting…</h1>
          <p className="sub">Talking to the vault service worker.</p>
        </div>
      ) : !state.unlocked ? (
        <>
          <div className="headline">
            <h1>Vault is locked</h1>
            <p className="sub">
              Open the web app, unlock, then tap{" "}
              <strong>Sync to browser extension</strong> in Security to send
              accounts here.
            </p>
          </div>
          <div className="status warn">
            <span className="dot" />
            Locked
          </div>
          <button
            className="btn block"
            onClick={() => chrome.tabs.create({ url: webAppUrl })}
          >
            Open vault
          </button>
        </>
      ) : (
        <>
          <div className="headline">
            <h1>{showAll ? "All accounts" : hostLabel || "Ready"}</h1>
            <p className="sub">
              {showAll
                ? "Live codes from your synced vault."
                : hostLabel
                  ? "Matching accounts for this tab."
                  : "Open a login page to see matches."}
            </p>
          </div>

          <div className="row">
            <div className="status">
              <span className="dot" />
              {state.accountCount} account
              {state.accountCount === 1 ? "" : "s"}
            </div>
            <button
              className="btn ghost small"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? (hostLabel ? "Show matches" : "Hide") : "Browse all"}
            </button>
          </div>

          {showAll && (
            <input
              type="search"
              className="search"
              placeholder="Search issuer or label…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          )}

          {visibleList === null ? (
            <p className="muted">Loading…</p>
          ) : visibleList.length === 0 ? (
            <div className="card">
              <div className="card-title">
                {showAll ? "No results" : "No match"}
              </div>
              <p className="muted">
                {showAll
                  ? "Try a different search term."
                  : "Nothing in your vault matches this tab."}
              </p>
            </div>
          ) : (
            <div className="list">
              {visibleList.map((m) => (
                <LiveCodeRow
                  key={m.id}
                  account={m}
                  tabId={tabId}
                  copied={copied === m.id}
                  onCopy={copy}
                  onFill={fill}
                />
              ))}
            </div>
          )}

          <div className="footer">
            <button
              onClick={async () => {
                await send({ type: "LOCK" });
                setState({ ...state, unlocked: false, accountCount: 0 });
                setMatches(null);
                setAllAccounts(null);
              }}
            >
              Lock now
            </button>
            <button onClick={() => chrome.tabs.create({ url: webAppUrl })}>
              Open vault →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
