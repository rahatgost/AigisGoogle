// Phase 13.1 — Sharing UI section, rendered inside the Security tab.
//
// Three surfaces:
//   1. "Share an account" flow — pick one of your accounts + enter recipient
//      email; local decrypt → seal to recipient pub → insert vault_shares row.
//   2. Outgoing shares list — with revoke button (soft-delete + flags the
//      account for rotation).
//   3. Incoming shares list — decrypts sealed secrets in-session and shows
//      live TOTP codes read-only (no persistence in vault_accounts).

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import * as OTPAuth from "otpauth";
import { toast } from "sonner";
import { Share2, X, RefreshCw, Users, Inbox, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getVaultKey } from "@/lib/vault-session";
import { listAccounts, type DecryptedAccount } from "@/lib/vault-accounts";
import {
  clearNeedsRotation,
  ensureUserKeys,
  listIncomingShares,
  listOutgoingShares,
  revokeShare,
  shareAccountByEmail,
  type IncomingShare,
  type OutgoingShare,
  type UserKeyMaterial,
} from "@/lib/vault-sharing";
import {
  BORDER,
  CHARCOAL,
  CREAM_SOFT,
  MUTED,
  Notice,
  soft,
} from "@/components/aegis/chrome";
import { SectionLabel, SettingsGroup, SettingsRow } from "@/components/aegis/settings";

interface OwnedAccount {
  id: string;
  issuer: string;
  label: string;
  needs_rotation: boolean;
}

export function SharingSection() {
  const [keys, setKeys] = useState<UserKeyMaterial | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingShare[]>([]);
  const [incoming, setIncoming] = useState<IncomingShare[]>([]);
  const [rotationNeeded, setRotationNeeded] = useState<OwnedAccount[]>([]);
  const [accounts, setAccounts] = useState<DecryptedAccount[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: ensure keypair exists, then load all three lists in parallel.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dek = getVaultKey();
      if (!dek) {
        setLoading(false);
        return;
      }
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes.user?.id;
        if (!uid) throw new Error("Not signed in.");
        const km = await ensureUserKeys(uid, dek);
        if (cancelled) return;
        setKeys(km);
        await refreshLists(km, dek);
      } catch (err) {
        if (!cancelled) {
          setNotice({
            kind: "error",
            text: err instanceof Error ? err.message : "Could not load sharing.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshLists = async (km: UserKeyMaterial, dek: CryptoKey) => {
    const [out, inc, accts, rotRes] = await Promise.all([
      listOutgoingShares(),
      listIncomingShares(km),
      listAccounts(dek),
      supabase
        .from("vault_accounts")
        .select("id, issuer, label, needs_rotation")
        .eq("needs_rotation", true),
    ]);
    setOutgoing(out);
    setIncoming(inc);
    setAccounts(accts);
    setRotationNeeded((rotRes.data ?? []) as OwnedAccount[]);
  };

  const handleShareSubmit = async (accountId: string, email: string) => {
    setNotice(null);
    try {
      await shareAccountByEmail(accountId, email);
      const dek = getVaultKey();
      if (keys && dek) await refreshLists(keys, dek);
      setDialogOpen(false);
      toast.success("Shared. They'll see it after they unlock their vault.");
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not share account.",
      });
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await revokeShare(shareId);
      const dek = getVaultKey();
      if (keys && dek) await refreshLists(keys, dek);
      toast.success("Share revoked. Consider rotating the code at the source site.");
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not revoke share.",
      });
    }
  };

  const handleClearRotation = async (accountId: string) => {
    try {
      await clearNeedsRotation(accountId);
      setRotationNeeded((prev) => prev.filter((a) => a.id !== accountId));
    } catch {
      // no-op
    }
  };

  if (loading) return null;

  return (
    <>
      {rotationNeeded.length > 0 && (
        <div className="pt-3">
          <div
            className="rounded-[14px] border p-3 text-[13px]"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.03)", borderColor: BORDER }}
          >
            <div className="mb-2 flex items-center gap-2" style={{ color: CHARCOAL }}>
              <AlertTriangle className="h-4 w-4" strokeWidth={1.8} />
              <span className="font-medium">Rotate these secrets</span>
            </div>
            <p className="mb-2 text-[12.5px]" style={{ color: MUTED }}>
              You revoked a share for these accounts. TOTP secrets don't rotate
              automatically — sign in to each site's security page and
              re-enroll to invalidate the copy your former recipient held.
            </p>
            <ul className="flex flex-col gap-1">
              {rotationNeeded.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <span>
                    {a.issuer || "Account"}
                    {a.label ? ` · ${a.label}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleClearRotation(a.id)}
                    className="rounded-md px-2 py-0.5 text-[11px]"
                    style={{ color: MUTED, border: `1px solid ${BORDER}` }}
                  >
                    Done
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <SectionLabel>Sharing</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          icon={<Share2 className="h-4 w-4" strokeWidth={1.8} />}
          title="Share an account"
          description="Send a code to another Aegis user, end-to-end encrypted"
          onClick={() => setDialogOpen(true)}
          chevron
          disabled={accounts.length === 0}
        />
        <SettingsRow
          icon={<Users className="h-4 w-4" strokeWidth={1.8} />}
          title="Outgoing shares"
          value={
            outgoing.filter((s) => !s.revokedAt).length === 0
              ? "None"
              : `${outgoing.filter((s) => !s.revokedAt).length} active`
          }
        />
        <SettingsRow
          icon={<Inbox className="h-4 w-4" strokeWidth={1.8} />}
          title="Shared with you"
          value={incoming.length === 0 ? "None" : `${incoming.length} account${incoming.length === 1 ? "" : "s"}`}
        />
      </SettingsGroup>

      {outgoing.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {outgoing.map((share) => (
            <div
              key={share.id}
              className="flex items-center gap-2 rounded-[12px] border px-3 py-2 text-[13px]"
              style={{ background: CREAM_SOFT, borderColor: BORDER, opacity: share.revokedAt ? 0.55 : 1 }}
            >
              <Share2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} style={{ color: MUTED }} />
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ color: CHARCOAL }}>
                  {share.issuer || "Account"}
                  {share.label ? ` · ${share.label}` : ""}
                </div>
                <div className="text-[11px]" style={{ color: MUTED }}>
                  {share.revokedAt ? "Revoked" : "Active"} · {new Date(share.createdAt).toLocaleDateString()}
                </div>
              </div>
              {!share.revokedAt && (
                <button
                  type="button"
                  onClick={() => handleRevoke(share.id)}
                  className="rounded-md px-2 py-1 text-[11px]"
                  style={{ color: MUTED, border: `1px solid ${BORDER}` }}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {incoming.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {incoming.map((share) => (
            <IncomingShareCard key={share.id} share={share} />
          ))}
        </div>
      )}

      {notice && (
        <div className="pt-2">
          <Notice kind={notice.kind}>{notice.text}</Notice>
        </div>
      )}

      {dialogOpen && (
        <ShareDialog
          accounts={accounts}
          onCancel={() => setDialogOpen(false)}
          onSubmit={handleShareSubmit}
        />
      )}
    </>
  );
}

/* ---------------- share dialog ---------------- */

function ShareDialog({
  accounts,
  onCancel,
  onSubmit,
}: {
  accounts: DecryptedAccount[];
  onCancel: () => void;
  onSubmit: (accountId: string, email: string) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId || !email.trim()) return;
    setBusy(true);
    try {
      await onSubmit(accountId, email.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={soft}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[18px] p-5"
        style={{ background: CREAM_SOFT, border: `1px solid ${BORDER}` }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-medium" style={{ color: CHARCOAL }}>
            Share an account
          </h3>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X className="h-4 w-4" strokeWidth={1.8} style={{ color: MUTED }} />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: MUTED }}>
            Account
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="rounded-[10px] border bg-transparent px-3 py-2 text-[14px]"
              style={{ borderColor: BORDER, color: CHARCOAL }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.issuer || "Account"}
                  {a.label ? ` · ${a.label}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: MUTED }}>
            Recipient's email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="friend@example.com"
              className="rounded-[10px] border bg-transparent px-3 py-2 text-[14px]"
              style={{ borderColor: BORDER, color: CHARCOAL }}
            />
          </label>
          <p className="text-[11.5px]" style={{ color: MUTED }}>
            They must already have an Aegis account and have unlocked their
            vault at least once (that's when their sharing key is created).
          </p>
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-[10px] border px-3 py-2 text-[13px]"
              style={{ borderColor: BORDER, color: CHARCOAL }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !accountId || !email.trim()}
              className="rounded-[10px] px-3 py-2 text-[13px] disabled:opacity-55"
              style={{ background: CHARCOAL, color: CREAM_SOFT }}
            >
              {busy ? "Sharing…" : "Share"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

/* ---------------- incoming share card with live TOTP ---------------- */

function IncomingShareCard({ share }: { share: IncomingShare }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const { code, remaining } = useMemo(() => {
    try {
      if (share.otpType === "totp") {
        const t = new OTPAuth.TOTP({
          issuer: share.issuer,
          label: share.label,
          algorithm: share.algorithm,
          digits: share.digits,
          period: share.period,
          secret: OTPAuth.Secret.fromBase32(share.secret.replace(/\s/g, "").toUpperCase()),
        });
        const seconds = Math.floor(now / 1000);
        const step = share.period;
        const left = step - (seconds % step);
        return { code: t.generate({ timestamp: now }), remaining: left };
      }
      return { code: "——", remaining: 0 };
    } catch {
      return { code: "error", remaining: 0 };
    }
  }, [share, now]);

  return (
    <div
      className="flex items-center gap-3 rounded-[12px] border px-3 py-2"
      style={{ background: CREAM_SOFT, borderColor: BORDER }}
    >
      <Inbox className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} style={{ color: MUTED }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]" style={{ color: CHARCOAL }}>
          {share.issuer || "Shared account"}
          {share.label ? ` · ${share.label}` : ""}
        </div>
        <div className="text-[11px]" style={{ color: MUTED }}>
          Shared · read-only
        </div>
      </div>
      <div
        className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-[15px] tracking-[0.14em]"
        style={{ color: CHARCOAL, background: "rgb(var(--aegis-ink-rgb) / 0.05)" }}
      >
        <span>{code}</span>
        {share.otpType === "totp" && (
          <span className="text-[10px]" style={{ color: MUTED }}>
            {remaining}s
          </span>
        )}
      </div>
    </div>
  );
}
