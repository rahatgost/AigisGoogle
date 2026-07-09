// Phase 13.2 — Family plan screen.
//
// One page renders three states:
//   1. Not in a family → "Create a family" + pending invites list
//   2. Member of a family → member roster, ability to leave, incoming
//      family-shared credentials (via the existing incoming-shares path)
//   3. Admin of a family → member roster + invite management + shared
//      accounts list + "Share an account with the family" flow.

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useLingui } from "@lingui/react";
import {
  ArrowLeft,
  Users,
  Mail,
  UserPlus,
  Crown,
  LogOut,
  Trash2,
  Share2,
  RefreshCw,
  Check,
  X,
  Loader2,
  Inbox,
} from "lucide-react";
import { AegisScreen } from "@/components/aegis/chrome";
import { BORDER, CHARCOAL, CREAM_SOFT, MUTED, Notice } from "@/components/aegis/chrome";
import {
  AppBar,
  AppBarButton,
  LargeTitle,
  SectionLabel,
  SettingsGroup,
  SettingsRow,
} from "@/components/aegis/settings";
import {
  acceptInvite,
  createFamily,
  declineInvite,
  deleteFamily,
  inviteMember,
  leaveFamily,
  listInvitesForMe,
  listOwnedAccountsForFamily,
  loadFamilyOverview,
  removeMember,
  revokeInvite,
  shareAccountWithFamily,
  syncFamilyShares,
  unshareAccountFromFamily,
  type FamilyInvite,
  type FamilyMember,
  type FamilyOverview,
  type FamilySharedAccount,
  type OwnedAccountSummary,
} from "@/lib/family";
import { usePlan } from "@/hooks/use-plan";
import { UpgradePrompt } from "@/components/aegis/upgrade-prompt";


export const Route = createFileRoute("/_authenticated/family")({
  head: () => ({
    meta: [
      { title: "Family — Aegis" },
      { name: "description", content: "Share your Aegis codes with up to 6 family members." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: FamilyPage,
});

function useT() {
  const { i18n } = useLingui();
  return (id: string, fallback: string, values?: Record<string, string | number>) => {
    let msg = i18n._(id);
    if (msg === id) msg = fallback;
    if (values) {
      for (const [k, v] of Object.entries(values)) {
        msg = msg.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return msg;
  };
}

function FamilyPage() {
  const router = useRouter();
  const plan = usePlan();
  const t = useT();
  const [overview, setOverview] = useState<FamilyOverview | null>(null);

  const [pendingInvitesForMe, setPendingInvitesForMe] = useState<
    Array<FamilyInvite & { familyName: string }>
  >([]);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [pickerAccounts, setPickerAccounts] = useState<OwnedAccountSummary[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ov, invites] = await Promise.all([loadFamilyOverview(), listInvitesForMe()]);
      setOverview(ov);
      setPendingInvitesForMe(invites);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : t("family.err.load", "Could not load family."),
      });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isAdmin = overview?.role === "admin";
  const memberCount = overview?.members.length ?? 0;
  const seats = 6 - memberCount;

  const run = async (fn: () => Promise<void | string>, okMessage?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const maybeMsg = await fn();
      if (okMessage) toast.success(typeof maybeMsg === "string" ? maybeMsg : okMessage);
      await refresh();
    } catch (err) {
      const anyErr = err as { message?: string; hint?: string; details?: string } | null;
      const text =
        err instanceof Error
          ? err.message
          : (anyErr?.message ?? anyErr?.hint ?? anyErr?.details ?? t("family.err.generic", "Something went wrong."));
      // Surface the raw shape for diagnosis when it's not a plain Error.
      // eslint-disable-next-line no-console
      console.error("[family] action failed:", err);
      setNotice({ kind: "error", text });
      toast.error(text);
    } finally {
      setBusy(false);
    }
  };

  const openPicker = async () => {
    if (!overview?.family) return;
    setShowAccountPicker(true);
    try {
      const list = await listOwnedAccountsForFamily(overview.family.id);
      setPickerAccounts(list);
    } catch (err) {
      setPickerAccounts([]);
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : t("family.err.loadAccounts", "Could not load your accounts."),
      });
    }
  };

  return (
    <AegisScreen>
      <AppBar
        title={t("family.title", "Family")}
        trailing={
          <AppBarButton label={t("family.back", "Back")} onClick={() => router.history.back()}>
            <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          </AppBarButton>
        }
      />
      <div
        className="aegis-scroll -mx-6 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-8"
        style={{ WebkitOverflowScrolling: "touch" as never }}
      >
        <LargeTitle
          title={overview?.family?.name ?? t("family.title", "Family")}
          subtitle={
            overview?.family
              ? t("family.subtitle.members", "{count}/6 members • end-to-end encrypted sharing", { count: memberCount })
              : t("family.subtitle.pitch", "Share Aegis codes with up to 6 people.")
          }
        />

        {notice && (
          <div className="pt-2">
            <Notice kind={notice.kind}>{notice.text}</Notice>
          </div>
        )}

        {/* Pending invites addressed to me — always shown up top. */}
        {pendingInvitesForMe.length > 0 && (
          <>
            <SectionLabel>{t("family.invitesForYou", "Invites for you")}</SectionLabel>
            <SettingsGroup>
              {pendingInvitesForMe.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: "rgb(var(--aegis-ink-rgb) / 0.05)",
                      border: `1px solid ${BORDER}`,
                      color: CHARCOAL,
                    }}
                  >
                    <Inbox className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14.5px]" style={{ color: CHARCOAL, fontWeight: 500 }}>
                      {inv.familyName}
                    </span>
                    <span className="mt-0.5 text-[12.5px]" style={{ color: MUTED }}>
                      {t("family.invitedOn", "Invited {date}", { date: new Date(inv.createdAt).toLocaleDateString() })}
                    </span>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await acceptInvite(inv.id);
                      }, t("family.toast.joined", "Joined the family."))
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-50"
                    aria-label={t("family.acceptAria", "Accept invite")}
                    style={{ background: CHARCOAL, color: CREAM_SOFT }}
                  >
                    <Check className="h-4 w-4" strokeWidth={2} />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await declineInvite(inv.id);
                      }, t("family.toast.declined", "Invite declined."))
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-50"
                    aria-label={t("family.declineAria", "Decline invite")}
                    style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL, border: `1px solid ${BORDER}` }}
                  >
                    <X className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
              ))}
            </SettingsGroup>
          </>
        )}

        {/* State 1: No family yet — offer creation. */}
        {overview && !overview.family && !plan.isFamily && (
          <div className="pt-3">
            <UpgradePrompt
              title={t("family.upgrade.title", "Family sharing is a Family-plan feature")}
              body={t(
                "family.upgrade.body",
                "Upgrade to Family to create a household, invite up to 6 members, and share Aegis codes end-to-end encrypted.",
              )}
              tier="Family"
            />
          </div>
        )}

        {/* State 1: No family yet — offer creation. */}
        {overview && !overview.family && plan.isFamily && (
          <>
            <SectionLabel>{t("family.start.section", "Start a family")}</SectionLabel>
            <SettingsGroup>
              <div className="flex flex-col gap-3 px-4 py-4">
                <label className="text-[12.5px]" style={{ color: MUTED }}>
                  {t("family.start.nameLabel", "Family name")}
                </label>
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder={t("family.start.namePlaceholder", "e.g. Rahman household")}
                  maxLength={80}
                  className="rounded-[10px] px-3 py-2 text-[14px] outline-none"
                  style={{
                    background: "white",
                    border: `1px solid ${BORDER}`,
                    color: CHARCOAL,
                  }}
                />
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  disabled={busy || !nameDraft.trim()}
                  onClick={() =>
                    run(async () => {
                      await createFamily(nameDraft);
                      setNameDraft("");
                    }, t("family.toast.created", "Family created."))
                  }
                  className="flex items-center justify-center gap-2 rounded-[12px] px-4 py-2.5 text-[14px] disabled:opacity-50"
                  style={{ background: CHARCOAL, color: CREAM_SOFT, fontWeight: 600 }}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  {t("family.start.cta", "Create family")}
                </motion.button>
              </div>
            </SettingsGroup>
            <p className="px-2 pt-3 text-[12px]" style={{ color: MUTED }}>
              {t(
                "family.start.hint",
                "You'll be the admin. Invite up to 5 more people by email — they need an Aegis account and a set-up vault to accept.",
              )}
            </p>
          </>
        )}


        {/* State 2/3: In a family — roster. */}
        {overview?.family && (
          <>
            <SectionLabel>{t("family.members", "Members")}</SectionLabel>
            <SettingsGroup>
              {overview.members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  canRemove={isAdmin && m.role !== "admin"}
                  onRemove={() =>
                    run(async () => {
                      await removeMember(m.id);
                    }, t("family.toast.removed", "Removed from family."))
                  }
                  busy={busy}
                />
              ))}
            </SettingsGroup>

            {/* Admin: invites + shared accounts. */}
            {isAdmin && (
              <>
                <SectionLabel>{t("family.invite.section", "Invite by email")}</SectionLabel>
                <SettingsGroup>
                  <div className="flex flex-col gap-3 px-4 py-4">
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder={t("family.invite.placeholder", "name@example.com")}
                        maxLength={255}
                        disabled={seats <= 0}
                        className="flex-1 rounded-[10px] px-3 py-2 text-[14px] outline-none disabled:opacity-60"
                        style={{ background: "white", border: `1px solid ${BORDER}`, color: CHARCOAL }}
                      />
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        disabled={busy || !inviteEmail.trim() || seats <= 0}
                        onClick={() =>
                          run(async () => {
                            await inviteMember(overview.family!.id, inviteEmail);
                            setInviteEmail("");
                          }, t("family.toast.invited", "Invitation created."))
                        }
                        className="flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] disabled:opacity-50"
                        style={{ background: CHARCOAL, color: CREAM_SOFT, fontWeight: 600 }}
                      >
                        <UserPlus className="h-4 w-4" />
                        {t("family.invite.cta", "Invite")}
                      </motion.button>
                    </div>
                    <p className="text-[11.5px]" style={{ color: MUTED }}>
                      {seats > 0
                        ? seats === 1
                          ? t("family.invite.seatsLeft.one", "1 seat left. Invitees see the invite next time they open Aegis.")
                          : t("family.invite.seatsLeft.other", "{count} seats left. Invitees see the invite next time they open Aegis.", { count: seats })
                        : t("family.invite.full", "Family is full. Remove a member to add someone else.")}
                    </p>
                  </div>
                </SettingsGroup>

                {overview.invites.filter((i) => i.status === "pending").length > 0 && (
                  <>
                    <SectionLabel>{t("family.pending", "Pending invites")}</SectionLabel>
                    <SettingsGroup>
                      {overview.invites
                        .filter((i) => i.status === "pending")
                        .map((inv) => (
                          <SettingsRow
                            key={inv.id}
                            icon={<Mail className="h-4 w-4" strokeWidth={1.8} />}
                            title={inv.email}
                            description={t("family.pending.expires", "Expires {date}", { date: new Date(inv.expiresAt).toLocaleDateString() })}
                            trailing={
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    await revokeInvite(inv.id);
                                  }, t("family.toast.revoked", "Invite revoked."))
                                }
                                className="rounded-[8px] px-2 py-1 text-[12px] disabled:opacity-50"
                                style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL, border: `1px solid ${BORDER}` }}
                              >
                                {t("family.pending.revoke", "Revoke")}
                              </button>
                            }
                          />
                        ))}
                    </SettingsGroup>
                  </>
                )}

                <SectionLabel>{t("family.shared.section", "Shared with family")}</SectionLabel>
                <SettingsGroup>
                  {overview.sharedAccounts.length === 0 && (
                    <div className="px-4 py-4 text-[13px]" style={{ color: MUTED }}>
                      {t("family.shared.empty", "No accounts shared yet. Pick one to share the code with everyone in your family.")}
                    </div>
                  )}
                  {overview.sharedAccounts.map((s) => (
                    <SharedAccountRow
                      key={s.id}
                      shared={s}
                      onUnshare={() =>
                        run(async () => {
                          await unshareAccountFromFamily(s.id);
                        }, t("family.toast.unshared", "Unshared. Consider rotating the code at the source site."))
                      }
                      busy={busy}
                    />
                  ))}
                  <div className="flex items-center gap-2 px-4 py-3">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      disabled={busy}
                      onClick={openPicker}
                      className="flex flex-1 items-center justify-center gap-2 rounded-[10px] px-3 py-2 text-[13.5px] disabled:opacity-50"
                      style={{ background: CHARCOAL, color: CREAM_SOFT, fontWeight: 600 }}
                    >
                      <Share2 className="h-4 w-4" />
                      {t("family.shared.cta", "Share an account")}
                    </motion.button>
                    {overview.sharedAccounts.some((s) => s.missingRecipients.length > 0) && (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const res = await syncFamilyShares(overview.family!.id);
                            return res.created === 1
                              ? t("family.toast.synced.one", "Synced 1 share.")
                              : t("family.toast.synced.other", "Synced {count} shares.", { count: res.created });
                          })
                        }
                        className="flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] disabled:opacity-50"
                        style={{
                          background: "rgb(var(--aegis-ink-rgb) / 0.06)",
                          color: CHARCOAL,
                          border: `1px solid ${BORDER}`,
                        }}
                      >
                        <RefreshCw className="h-4 w-4" />
                        {t("family.shared.sync", "Sync")}
                      </motion.button>
                    )}
                  </div>
                </SettingsGroup>
              </>
            )}

            <SectionLabel>{t("family.membership", "Membership")}</SectionLabel>
            <SettingsGroup>
              {!isAdmin && (
                <SettingsRow
                  icon={<LogOut className="h-4 w-4" strokeWidth={1.8} />}
                  title={t("family.leave.title", "Leave family")}
                  description={t("family.leave.desc", "You'll lose access to family-shared codes.")}
                  danger
                  onClick={() =>
                    run(async () => {
                      await leaveFamily();
                    }, t("family.toast.left", "You've left the family."))
                  }
                />
              )}
              {isAdmin && (
                <SettingsRow
                  icon={<Trash2 className="h-4 w-4" strokeWidth={1.8} />}
                  title={t("family.delete.title", "Delete family")}
                  description={t("family.delete.desc", "Removes every member and revokes all family shares. This can't be undone.")}
                  danger
                  onClick={() => {
                    if (!confirm(t("family.delete.confirm", "Delete this family? Every family share will be revoked."))) return;
                    void run(async () => {
                      await deleteFamily(overview.family!.id);
                    }, t("family.toast.deleted", "Family deleted."));
                  }}
                />
              )}
            </SettingsGroup>
          </>
        )}

        <div className="pt-4 text-center">
          <Link to="/profile" className="text-[12.5px]" style={{ color: MUTED }}>
            {t("family.backToProfile", "Back to profile")}
          </Link>
        </div>
      </div>

      {showAccountPicker && overview?.family && (
        <AccountPickerSheet
          accounts={pickerAccounts}
          onClose={() => {
            setShowAccountPicker(false);
            setPickerAccounts(null);
          }}
          onPick={async (accountId) => {
            setShowAccountPicker(false);
            setPickerAccounts(null);
            await run(async () => {
              const res = await shareAccountWithFamily(overview.family!.id, accountId);
              return res.createdShareCount === 1
                ? t("family.toast.sharedWith.one", "Shared with 1 member.")
                : t("family.toast.sharedWith.other", "Shared with {count} members.", { count: res.createdShareCount });
            });
          }}
        />
      )}
    </AegisScreen>
  );
}

function MemberRow({
  member,
  canRemove,
  onRemove,
  busy,
}: {
  member: FamilyMember;
  canRemove: boolean;
  onRemove: () => void;
  busy: boolean;
}) {
  const t = useT();
  const displayName = member.displayName || t("family.member.fallback", "Member");
  const initial = displayName.slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-[13px]"
        style={{
          background: "rgb(var(--aegis-ink-rgb) / 0.06)",
          border: `1px solid ${BORDER}`,
          color: CHARCOAL,
          fontWeight: 600,
        }}
      >
        {member.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14.5px]" style={{ color: CHARCOAL, fontWeight: 500 }}>
            {displayName}
          </span>
          {member.role === "admin" && (
            <Crown className="h-3.5 w-3.5" strokeWidth={1.8} style={{ color: MUTED }} />
          )}
        </div>
        <span className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
          {t("family.member.joined", "Joined {date}", { date: new Date(member.joinedAt).toLocaleDateString() })}
        </span>
      </div>
      {canRemove && (
        <button
          disabled={busy}
          onClick={() => {
            if (!confirm(t("family.member.removeConfirm", "Remove {name} from the family?", { name: displayName }))) return;
            onRemove();
          }}
          className="rounded-[8px] px-2 py-1 text-[12px] disabled:opacity-50"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL, border: `1px solid ${BORDER}` }}
        >
          {t("family.member.remove", "Remove")}
        </button>
      )}
    </div>
  );
}

function SharedAccountRow({
  shared,
  onUnshare,
  busy,
}: {
  shared: FamilySharedAccount;
  onUnshare: () => void;
  busy: boolean;
}) {
  const t = useT();
  const missing = shared.missingRecipients.length;
  const missingText =
    missing === 0
      ? ""
      : missing === 1
        ? t("family.shared.outOfSync.one", "1 member out of sync")
        : t("family.shared.outOfSync.other", "{count} members out of sync", { count: missing });
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{
          background: "rgb(var(--aegis-ink-rgb) / 0.05)",
          border: `1px solid ${BORDER}`,
          color: CHARCOAL,
        }}
      >
        <Share2 className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14.5px]" style={{ color: CHARCOAL, fontWeight: 500 }}>
          {shared.issuer}
        </span>
        <span className="mt-0.5 truncate text-[12px]" style={{ color: MUTED }}>
          {shared.label || "•"} {missing > 0 && `• ${missingText}`}
        </span>
      </div>
      <button
        disabled={busy}
        onClick={() => {
          if (!confirm(t("family.shared.unshareConfirm", "Unshare this account from the whole family?"))) return;
          onUnshare();
        }}
        className="rounded-[8px] px-2 py-1 text-[12px] disabled:opacity-50"
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL, border: `1px solid ${BORDER}` }}
      >
        {t("family.shared.unshare", "Unshare")}
      </button>
    </div>
  );
}

function AccountPickerSheet({
  accounts,
  onPick,
  onClose,
}: {
  accounts: OwnedAccountSummary[] | null;
  onPick: (accountId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const available = useMemo(() => (accounts ?? []).filter((a) => !a.alreadyShared), [accounts]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-t-[20px] px-5 pt-5 pb-8"
        style={{ background: CREAM_SOFT, border: `1px solid ${BORDER}` }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full" style={{ background: BORDER }} />
        <h2 className="text-[16px]" style={{ color: CHARCOAL, fontWeight: 600 }}>
          {t("family.picker.title", "Share which account?")}
        </h2>
        <p className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
          {t("family.picker.desc", "The TOTP secret is encrypted per family member on this device.")}
        </p>
        <div className="mt-4 max-h-[50vh] overflow-y-auto">
          {accounts === null && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: MUTED }} />
            </div>
          )}
          {accounts !== null && available.length === 0 && (
            <div className="py-6 text-center text-[13px]" style={{ color: MUTED }}>
              {t("family.picker.empty", "Nothing left to share — every account is already family-shared.")}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {available.map((a) => (
              <button
                key={a.id}
                onClick={() => onPick(a.id)}
                className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-left"
                style={{ background: "white", border: `1px solid ${BORDER}` }}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px]" style={{ color: CHARCOAL, fontWeight: 500 }}>
                    {a.issuer || t("family.picker.untitled", "Untitled")}
                  </span>
                  <span className="truncate text-[12px]" style={{ color: MUTED }}>
                    {a.label}
                  </span>
                </div>
                <Share2 className="h-4 w-4" strokeWidth={1.8} style={{ color: MUTED }} />
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-[10px] py-2 text-[13px]"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL, border: `1px solid ${BORDER}` }}
        >
          {t("family.picker.cancel", "Cancel")}
        </button>
      </motion.div>
    </div>
  );
}
