// Emergency Access — Family plan.
//
// One screen with two sections:
//   • Trusted contacts (I granted): manage recipients, waiting periods,
//     handle incoming access requests.
//   • Recover for others (I received): request/unlock grantors' vaults.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useLingui } from "@lingui/react";
import { ArrowLeft, Loader2, Trash2, UserPlus, Unlock, Clock, ShieldCheck } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { AegisScreen, BORDER, CHARCOAL, MUTED, Notice } from "@/components/aegis/chrome";
import { AppBar, AppBarButton, LargeTitle, SectionLabel, SettingsGroup } from "@/components/aegis/settings";
import { usePlan } from "@/hooks/use-plan";
import { UpgradePrompt } from "@/components/aegis/upgrade-prompt";
import { setVaultKey, useVaultUnlocked } from "@/lib/vault-session";
import {
  approveRequest,
  inviteContact,
  listMyContacts,
  listMyGrantors,
  msUntilUnlock,
  rejectRequest,
  requestAccess,
  revokeContact,
  unlockAvailable,
  unlockGrantorVault,
  type EmergencyContactRow,
} from "@/lib/emergency";

export const Route = createFileRoute("/_authenticated/emergency")({
  head: () => ({
    meta: [
      { title: "Emergency access — Aegis" },
      { name: "description", content: "Trusted-contact recovery for your Aegis vault." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EmergencyPage,
});

function useT() {
  const { i18n } = useLingui();
  return (id: string, fallback: string, values?: Record<string, string | number>) => {
    let msg = i18n._(id);
    if (msg === id) msg = fallback;
    if (values) for (const [k, v] of Object.entries(values)) msg = msg.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    return msg;
  };
}

const WAIT_OPTIONS = [1, 3, 7, 14, 30];

function EmergencyPage() {
  const t = useT();
  const router = useRouter();
  const plan = usePlan();
  const unlocked = useVaultUnlocked();
  const canUse = plan.hasFeature("emergency-access");

  const [contacts, setContacts] = useState<EmergencyContactRow[]>([]);
  const [grantors, setGrantors] = useState<EmergencyContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDays, setInviteDays] = useState(7);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mine, grantorsList] = await Promise.all([listMyContacts(), listMyGrantors()]);
      setContacts(mine);
      setGrantors(grantorsList);
    } catch (err) {
      console.error("[emergency] refresh", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Ticker so countdowns update.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const onInvite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    try {
      await inviteContact(inviteEmail, inviteDays);
      toast.success(t("emergency.toast.invited", "Trusted contact added"));
      setInviteEmail("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (row: EmergencyContactRow) => {
    if (!confirm(t("emergency.confirm.revoke", "Revoke emergency access for {email}?", { email: row.granteeEmail }))) return;
    try {
      await revokeContact(row.id);
      toast.success(t("emergency.toast.revoked", "Access revoked"));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const onApprove = async (row: EmergencyContactRow) => {
    try {
      await approveRequest(row.id);
      toast.success(t("emergency.toast.approved", "Request approved"));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const onReject = async (row: EmergencyContactRow) => {
    try {
      await rejectRequest(row.id);
      toast.success(t("emergency.toast.rejected", "Request rejected"));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const onRequest = async (row: EmergencyContactRow) => {
    if (!confirm(t("emergency.confirm.request", "Request emergency access? {name} will be notified.", { name: shortId(row.grantorId) }))) return;
    try {
      await requestAccess(row.id);
      toast.success(t("emergency.toast.requested", "Request sent — waiting period started"));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const onUnlock = async (row: EmergencyContactRow) => {
    try {
      const key = await unlockGrantorVault(row.id);
      setVaultKey(key, { readOnly: true });
      toast.success(t("emergency.toast.unlocked", "Recovery vault unlocked (read-only)"));
      router.navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <AegisScreen>
      <AppBar
        title={t("emergency.title", "Emergency access")}
        trailing={
          <AppBarButton label={t("common.back", "Back")} onClick={() => router.history.back()}>
            <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          </AppBarButton>
        }
      />
      <div
        className="aegis-scroll -mx-6 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-8"
        style={{ WebkitOverflowScrolling: "touch" as never }}
      >
        <LargeTitle
          title={t("emergency.title", "Emergency access")}
          subtitle={t(
            "emergency.subtitle",
            "Grant trusted people read-only recovery to your vault after a waiting period you control.",
          )}
        />

      {!canUse && (
        <div className="pt-2">
          <UpgradePrompt
            title={t("emergency.upgrade.title", "Emergency access is a Family-plan feature")}
            body={t(
              "emergency.upgrade.body",
              "Upgrade to Family to designate trusted contacts who can recover your vault in a crisis.",
            )}
            tier="Family"
          />
        </div>
      )}

      {canUse && !unlocked && (
        <div className="pt-2">
          <Notice kind="info">{t("emergency.locked", "Unlock your vault first to manage emergency contacts.")}</Notice>
        </div>
      )}

      {canUse && unlocked && (
        <>
          {/* Invite */}
          <SectionLabel>{t("emergency.invite.section", "Add a trusted contact")}</SectionLabel>
          <SettingsGroup>
            <div className="flex flex-col gap-3 px-4 py-4">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={t("emergency.invite.emailPh", "contact@example.com")}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="rounded-[10px] px-3 py-2 text-[14px] outline-none"
                style={{ background: "rgb(var(--aegis-ink-rgb) / 0.04)", border: `1px solid ${BORDER}`, color: CHARCOAL }}
              />
              <div>
                <label className="text-[12.5px]" style={{ color: MUTED }}>
                  {t("emergency.invite.waitLabel", "Waiting period")}
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WAIT_OPTIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setInviteDays(d)}
                      className="rounded-full px-3 py-1 text-[12.5px]"
                      style={{
                        border: `1px solid ${BORDER}`,
                        background: inviteDays === d ? CHARCOAL : "transparent",
                        color: inviteDays === d ? "white" : CHARCOAL,
                      }}
                    >
                      {t("emergency.days", "{n}d", { n: d })}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={onInvite}
                disabled={busy || !inviteEmail.trim()}
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-[10px] px-4 py-2 text-[14px] font-medium"
                style={{ background: CHARCOAL, color: "white", opacity: busy || !inviteEmail.trim() ? 0.5 : 1 }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {t("emergency.invite.cta", "Add contact")}
              </button>
              <p className="text-[11.5px]" style={{ color: MUTED }}>
                {t(
                  "emergency.invite.hint",
                  "The contact must already have an Aegis account and have unlocked it once so we can seal your recovery key end-to-end.",
                )}
              </p>
            </div>
          </SettingsGroup>

          {/* Contacts I granted */}
          <SectionLabel>{t("emergency.mine.section", "People I trust")}</SectionLabel>
          <SettingsGroup>
            {loading ? (
              <div className="flex items-center justify-center px-4 py-6" style={{ color: MUTED }}>
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : contacts.length === 0 ? (
              <div className="px-4 py-4 text-[13px]" style={{ color: MUTED }}>
                {t("emergency.mine.empty", "No trusted contacts yet.")}
              </div>
            ) : (
              contacts.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[14px]" style={{ color: CHARCOAL }}>{row.granteeEmail}</span>
                    <span className="text-[12px]" style={{ color: MUTED }}>
                      {statusLabel(t, row)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.status === "requested" && (
                      <>
                        <button
                          type="button"
                          onClick={() => onApprove(row)}
                          className="rounded-full px-3 py-1 text-[12.5px]"
                          style={{ background: CHARCOAL, color: "white" }}
                        >
                          {t("emergency.action.approve", "Approve")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onReject(row)}
                          className="rounded-full px-3 py-1 text-[12.5px]"
                          style={{ border: `1px solid ${BORDER}`, color: CHARCOAL }}
                        >
                          {t("emergency.action.reject", "Reject")}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onRevoke(row)}
                      aria-label={t("emergency.action.revoke", "Revoke")}
                      className="grid h-8 w-8 place-items-center rounded-full"
                      style={{ border: `1px solid ${BORDER}`, color: CHARCOAL }}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </SettingsGroup>

          {/* Grantors — recover for others */}
          <SectionLabel>{t("emergency.received.section", "People who trust me")}</SectionLabel>
          <SettingsGroup>
            {loading ? (
              <div className="flex items-center justify-center px-4 py-6" style={{ color: MUTED }}>
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : grantors.length === 0 ? (
              <div className="px-4 py-4 text-[13px]" style={{ color: MUTED }}>
                {t("emergency.received.empty", "No one has designated you as their trusted contact yet.")}
              </div>
            ) : (
              grantors.map((row) => {
                const ready = unlockAvailable(row);
                const remaining = msUntilUnlock(row);
                return (
                  <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[14px]" style={{ color: CHARCOAL }}>
                        {t("emergency.received.grantor", "Grantor {name}", { name: shortId(row.grantorId) })}
                      </span>
                      <span className="text-[12px]" style={{ color: MUTED }}>
                        {row.status === "requested" && !ready
                          ? t("emergency.received.waiting", "Ready in {t}", { t: formatDuration(t, remaining) })
                          : statusLabel(t, row)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {row.status === "active" && (
                        <button
                          type="button"
                          onClick={() => onRequest(row)}
                          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12.5px]"
                          style={{ border: `1px solid ${BORDER}`, color: CHARCOAL }}
                        >
                          <Clock className="h-3.5 w-3.5" />
                          {t("emergency.action.request", "Request")}
                        </button>
                      )}
                      {ready && (
                        <button
                          type="button"
                          onClick={() => onUnlock(row)}
                          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12.5px]"
                          style={{ background: CHARCOAL, color: "white" }}
                        >
                          <Unlock className="h-3.5 w-3.5" />
                          {t("emergency.action.unlock", "Unlock")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </SettingsGroup>

          <div className="flex items-start gap-2 px-5 pt-3 pb-8 text-[12px]" style={{ color: MUTED }}>
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t(
                "emergency.footer",
                "Recovery keys are sealed end-to-end for each contact. The Aegis server never sees your vault key.",
              )}
            </span>
          </div>
        </>
      )}
      </div>
    </AegisScreen>
  );
}

function statusLabel(t: ReturnType<typeof useT>, row: EmergencyContactRow): string {
  const waited = t("emergency.status.wait", "{n}-day wait", { n: row.waitDays });
  switch (row.status) {
    case "active":
      return waited;
    case "requested":
      return t("emergency.status.requested", "Requested — {wait}", { wait: waited });
    case "approved":
      return t("emergency.status.approved", "Approved");
    case "revoked":
      return t("emergency.status.revoked", "Revoked");
  }
}

function formatDuration(t: ReturnType<typeof useT>, ms: number): string {
  if (ms <= 0) return t("emergency.duration.now", "now");
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return t("emergency.duration.dh", "{d}d {h}h", { d: days, h: hours });
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return t("emergency.duration.hm", "{h}h {m}m", { h: hours, m: mins });
}

function shortId(id: string): string {
  return id.slice(0, 6);
}

