// Phase 13.1 — Sharing UI.
//
// Two surfaces, split across tabs:
//   • SharingSection (Security tab) — outgoing shares list with revoke, plus
//     rotation reminders for accounts you previously shared.
//   • IncomingSharesSection (Vault tab) — accounts other people shared with
//     you, rendered as their own read-only group above your codes.

import { useEffect, useMemo, useState } from "react";
import * as OTPAuth from "otpauth";
import { toast } from "sonner";
import { Share2, Users, Inbox, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getVaultKey } from "@/lib/vault-session";
import {
  clearNeedsRotation,
  ensureUserKeys,
  listIncomingShares,
  listOutgoingShares,
  revokeShare,
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
} from "@/components/aegis/chrome";
import { SectionLabel, SettingsGroup, SettingsRow } from "@/components/aegis/settings";

interface OwnedAccount {
  id: string;
  issuer: string;
  label: string;
  needs_rotation: boolean;
}

/* ============================================================
   SharingSection — Security tab
   Shows only outgoing shares + rotation reminders.
   ============================================================ */

export function SharingSection() {
  const [keys, setKeys] = useState<UserKeyMaterial | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingShare[]>([]);
  const [rotationNeeded, setRotationNeeded] = useState<OwnedAccount[]>([]);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

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
        await refresh();
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

  const refresh = async () => {
    const [out, rotRes] = await Promise.all([
      listOutgoingShares(),
      supabase
        .from("vault_accounts")
        .select("id, issuer, label, needs_rotation")
        .eq("needs_rotation", true),
    ]);
    setOutgoing(out);
    setRotationNeeded((rotRes.data ?? []) as OwnedAccount[]);
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await revokeShare(shareId);
      await refresh();
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

  if (loading || !keys) return null;

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
          description="Open any account card and tap Share"
          value="From vault"
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
          description="Appears at the top of your vault"
          value="In vault"
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

      {notice && (
        <div className="pt-2">
          <Notice kind={notice.kind}>{notice.text}</Notice>
        </div>
      )}
    </>
  );
}

/* ============================================================
   IncomingSharesSection — Vault tab
   Rendered as its own group above the user's own accounts.
   ============================================================ */

export function IncomingSharesSection() {
  const [incoming, setIncoming] = useState<IncomingShare[]>([]);
  const [loading, setLoading] = useState(true);

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
        const inc = await listIncomingShares(km);
        if (!cancelled) setIncoming(inc);
      } catch {
        // Silently skip — sharing is optional; the Security tab surfaces errors.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || incoming.length === 0) return null;

  return (
    <div className="mb-2">
      <SectionLabel>Shared with you</SectionLabel>
      <div className="flex flex-col gap-1">
        {incoming.map((share) => (
          <IncomingShareCard key={share.id} share={share} />
        ))}
      </div>
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
