import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lockVault } from "@/lib/vault-session";
import { deleteMyAccount } from "@/lib/account.functions";
import {
  getMySubscription,
  createCheckoutSession,
  createPortalSession,
} from "@/lib/subscriptions.functions";
import { avatarPathFor, fileToSquareJpeg } from "@/lib/avatar";
import {
  cacheAvatarFromUrl,
  clearAvatarBlob,
  getAvatarBlob,
  putAvatarBlob,
} from "@/lib/avatar-cache";
import {
  User,
  Mail,
  Loader2,
  LogOut,
  Check,
  Pencil,
  Trash2,
  Camera,
  X,
  Monitor,
  Sun,
  Moon,
  Users,
  Sparkles,
  CreditCard,
  MessageCircle,
} from "lucide-react";
import { FeedbackSheet } from "@/components/aegis/feedback-sheet";
import {
  BORDER,
  CHARCOAL,
  CREAM_SOFT,
  DANGER,
  MUTED,
  Notice,
  soft,
} from "@/components/aegis/chrome";
import { LargeTitle, SectionLabel, SettingsGroup, SettingsRow } from "@/components/aegis/settings";
import { PlanComparisonSheet } from "@/components/aegis/plan-comparison-sheet";
import { PremiumWelcomeSheet } from "@/components/aegis/premium-welcome-sheet";
import { Eye } from "lucide-react";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import {
  SUPPORTED_LOCALES,
  getLocalePref,
  setLocalePref,
  type LocalePref,
} from "@/lib/i18n";
import { isGuestId } from "@/lib/guest-user";
import { LockedSection } from "@/components/aegis/LockedSection";
import { useLingui } from "@lingui/react";
import { Globe, LogIn } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_tabs/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Aegis" },
      {
        name: "description",
        content:
          "Manage your Aegis account: display name, avatar, theme, language, and sign-out.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Profile — Aegis" },
      {
        property: "og:description",
        content: "Account, appearance, and language settings for your Aegis authenticator.",
      },
      { property: "og:url", content: "https://aegis-v2.flinkeo.online/profile" },
    ],
  }),
  component: ProfilePage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => <NotFoundView />,
});

function NotFoundView() {
  const { i18n } = useLingui();
  const msg = i18n._("common.notFound");
  return <div className="p-6 text-sm">{msg === "common.notFound" ? "Not found" : msg}</div>;
}




function initials(source: string): string {
  const s = source.trim();
  if (!s) return "?";
  const parts = s.split(/[\s._@-]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : s.slice(0, 2);
  return chars.toUpperCase();
}

function ProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();
  const deleteAccount = useServerFn(deleteMyAccount);
  const fetchSub = useServerFn(getMySubscription);
  const startCheckout = useServerFn(createCheckoutSession);
  const openPortal = useServerFn(createPortalSession);

  const isGuest = isGuestId(user.id);
  const { data: sub, refetch: refetchSub } = useQuery({
    queryKey: ["subscription", user.id],
    queryFn: () => fetchSub(),
    staleTime: 30_000,
    enabled: !isGuest,
  });
  const [planBusy, setPlanBusy] = useState<null | "pro" | "family" | "portal">(null);
  const [planSheet, setPlanSheet] = useState(false);
  const [compareSheet, setCompareSheet] = useState(false);
  const [welcomeSheet, setWelcomeSheet] = useState(false);
  const [awaitingUpgrade, setAwaitingUpgrade] = useState(false);

  const activePaidTier = sub && sub.tier !== "free" && ["active", "trialing"].includes(sub.status);
  const planLabel = !sub
    ? "Loading…"
    : activePaidTier
      ? sub.tier === "family"
        ? "Family"
        : "Pro"
      : "Free";

  const openExternal = (url: string) => {
    // Stripe Checkout / Billing Portal refuse to render inside an iframe
    // (the Lovable preview is iframed), so a same-window navigation shows a
    // blank/black page. Break out of the frame — top-window nav when we can,
    // otherwise a new tab.
    try {
      const top = window.top;
      if (top && top !== window) {
        top.location.href = url;
        return;
      }
    } catch {
      // cross-origin top frame — fall through to window.open
    }
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) window.location.href = url;
  };

  const handleUpgrade = async (tier: "pro" | "family") => {
    setPlanBusy(tier);
    setNotice(null);
    try {
      const { url } = await startCheckout({
        data: { tier, origin: window.location.origin },
      });
      if (url) openExternal(url);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not start checkout.",
      });
    } finally {
      setPlanBusy(null);
    }
  };

  const handleManage = async () => {
    setPlanBusy("portal");
    setNotice(null);
    try {
      const { url } = await openPortal({ data: { origin: window.location.origin } });
      if (url) openExternal(url);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not open billing portal.",
      });
    } finally {
      setPlanBusy(null);
    }
  };

  // Re-check subscription after returning from Stripe Checkout (webhook may
  // arrive a beat later — refetch a few times, and once the paid tier
  // lands, fire the one-time welcome sheet.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      toast.success(t("profile.upgradeSyncToast", "Welcome to Pro. Give billing a moment to sync."));
      setAwaitingUpgrade(true);
      let tries = 0;
      const iv = setInterval(() => {
        void refetchSub();
        // Also invalidate the shared `usePlan()` cache so Security, Vault,
        // Family, and Emergency tabs pick up the new tier immediately
        // instead of waiting out the 5-minute staleTime.
        void queryClient.invalidateQueries({ queryKey: ["subscription", "me"] });
        if (++tries >= 8) clearInterval(iv);
      }, 1500);
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      window.history.replaceState({}, "", url.toString());
      return () => clearInterval(iv);
    }
  }, [refetchSub, queryClient]);

  // When the paid tier actually lands (via webhook), reveal the welcome
  // sheet exactly once per upgrade. Keyed by tier so a later Pro→Family
  // upgrade also celebrates.
  useEffect(() => {
    if (!sub || !activePaidTier) return;
    const key = `aegis:welcomed:${user.id}:${sub.tier}`;
    if (awaitingUpgrade && !localStorage.getItem(key)) {
      setWelcomeSheet(true);
      localStorage.setItem(key, "1");
      setAwaitingUpgrade(false);
    }
  }, [sub, activePaidTier, awaitingUpgrade, user.id]);

  // Auto-open the plan sheet when a gated feature deep-links here with
  // `#plan` (e.g. UpgradePrompt from the vault quota banner).
  useEffect(() => {
    const check = () => {
      if (window.location.hash === "#plan") {
        setPlanSheet(true);
        // Strip the hash so re-navigation re-opens cleanly.
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);




  const [displayName, setDisplayName] = useState("");
  const [initialName, setInitialName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [themeSheet, setThemeSheet] = useState(false);
  const [localeSheet, setLocaleSheet] = useState(false);
  const [feedbackSheet, setFeedbackSheet] = useState(false);

  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [themePref, setThemePrefState] = useState<ThemePref>(() => getThemePref());
  const [localePref, setLocalePrefState] = useState<LocalePref>(() => getLocalePref());
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { i18n } = useLingui();
  const t = (id: string, fallback: string) => {
    const msg = i18n._(id);
    return msg === id ? fallback : msg;
  };

  const chooseTheme = async (pref: ThemePref) => {
    setThemePrefState(pref);
    setThemePref(pref);
    try {
      await supabase.from("profiles").upsert({ id: user.id, theme_pref: pref }, { onConflict: "id" });
    } catch {
      // Local change already applied; sync will retry next sign-in.
    }
  };

  const chooseLocale = async (pref: LocalePref) => {
    setLocalePrefState(pref);
    setLocalePref(pref);
    try {
      // "system" is stored locally only — the server column tracks explicit
      // locales so a fresh device without localStorage falls back to browser
      // detection, matching the same "system" behaviour.
      const localeValue = pref === "system" ? null : pref;
      await supabase.from("profiles").upsert(
        { id: user.id, locale: localeValue },
        { onConflict: "id" },
      );
    } catch {
      // Local change already applied; sync will retry next sign-in.
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, avatar_url, theme_pref, locale")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) setNotice({ kind: "error", text: error.message });
      else {
        const v = data?.display_name ?? "";
        setDisplayName(v);
        setInitialName(v);
        setAvatarPath(data?.avatar_url ?? null);
        const p = data?.theme_pref;
        if (p === "system" || p === "light" || p === "dark") setThemePrefState(p);
        const l = data?.locale as LocalePref | null | undefined;
        if (l && (l === "system" || SUPPORTED_LOCALES.some((sl) => sl.code === l))) {
          setLocalePrefState(l);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // Refresh the signed URL whenever the stored path changes. Signed URLs
  // are the read path because the avatars bucket is private.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const setObj = (blob: Blob) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      setAvatarUrl(objectUrl);
    };

    if (!avatarPath) {
      // No server-side avatar → drop any cached blob so the UI stays truthful.
      setAvatarUrl(null);
      void clearAvatarBlob(user.id);
      return () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }

    (async () => {
      // 1) Paint from cache immediately (works offline, no flash).
      const cached = await getAvatarBlob(user.id);
      if (cancelled) return;
      if (cached) setObj(cached);

      // 2) Refresh from network in the background and update cache.
      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrl(avatarPath, 60 * 60);
      if (cancelled) return;
      if (error || !data?.signedUrl) {
        if (!cached) setAvatarUrl(null);
        return;
      }
      const fresh = await cacheAvatarFromUrl(user.id, data.signedUrl);
      if (cancelled) return;
      if (fresh) setObj(fresh);
      else if (!cached) {
        const sep = data.signedUrl.includes("?") ? "&" : "?";
        setAvatarUrl(
          avatarVersion ? `${data.signedUrl}${sep}v=${avatarVersion}` : data.signedUrl,
        );
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avatarPath, avatarVersion, user.id]);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: user.id, display_name: displayName.trim() || null }, { onConflict: "id" });
      if (error) throw error;
      setInitialName(displayName);
      setEditing(false);
      setNotice({ kind: "info", text: "Profile saved." });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setDisplayName(initialName);
    setEditing(false);
    setNotice(null);
  };

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    lockVault();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const handleDelete = async () => {
    const email = user.email ?? "your account";
    const ok = window.confirm(
      `Permanently delete ${email}?\n\nThis erases every stored code, your passphrase, and your account itself. It cannot be undone.`,
    );
    if (!ok) return;
    const confirmText = window.prompt('Type "delete" to confirm.');
    if (confirmText?.trim().toLowerCase() !== "delete") return;
    setDeleting(true);
    setNotice(null);
    try {
      await deleteAccount();
      await queryClient.cancelQueries();
      queryClient.clear();
      lockVault();
      await supabase.auth.signOut();
      navigate({ to: "/auth", replace: true });
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not delete account.",
      });
      setDeleting(false);
    }
  };

  const openAvatarSheet = () => {
    if (avatarBusy) return;
    setAvatarSheet(true);
  };

  const pickAvatarFile = () => {
    setAvatarSheet(false);
    // Give the sheet a beat to close before the OS picker steals focus.
    setTimeout(() => fileRef.current?.click(), 60);
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarBusy(true);
    setNotice(null);
    try {
      const blob = await fileToSquareJpeg(file);
      const path = avatarPathFor(user.id);
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { error: profErr } = await supabase
        .from("profiles")
        .upsert({ id: user.id, avatar_url: path }, { onConflict: "id" });
      if (profErr) throw profErr;
      // Prime the offline cache with the just-uploaded bytes.
      await putAvatarBlob(user.id, blob);
      setAvatarPath(path);
      setAvatarVersion(Date.now());
      setNotice({ kind: "info", text: t("profile.photoUpdated", "Photo updated") });
      toast.success(t("profile.photoUpdated", "Photo updated"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("profile.photoUpdateFailed", "Could not upload photo.");
      setNotice({ kind: "error", text: msg });
      toast.error(msg);
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarRemove = async () => {
    setAvatarSheet(false);
    if (!avatarPath || avatarBusy) return;
    setAvatarBusy(true);
    setNotice(null);
    try {
      const cleanPath = avatarPath.split("?")[0];
      await supabase.storage.from("avatars").remove([cleanPath]);
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: user.id, avatar_url: null }, { onConflict: "id" });
      if (error) throw error;
      await clearAvatarBlob(user.id);
      setAvatarPath(null);
      toast.success(t("profile.photoRemoved", "Photo removed"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("profile.photoRemoveFailed", "Could not remove photo.");
      setNotice({ kind: "error", text: msg });
      toast.error(msg);
    } finally {
      setAvatarBusy(false);
    }
  };

  const seed = displayName || user.email || "?";
  const displayShown = initialName || t("profile.unnamed", "Unnamed");
  const hasAvatar = !!avatarPath;

  return (
    <>
      <LargeTitle title={t("profile.title", "Account")} subtitle={t("profile.subtitle", "How you show up inside Aegis.")} />

      {isGuestId(user.id) && (
        <div className="pt-2">
          <LockedSection
            title={t("profile.guest.title", "You're using Aegis locally")}
            description={t(
              "profile.guest.description",
              "Your codes are encrypted on this device. Sign in to enable cloud backup, sync across devices, family sharing, and more.",
            )}
          />
        </div>
      )}

      <div className="flex flex-col gap-1 pt-1">

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={soft}
          className="scroll-fade-out flex shrink-0 items-center gap-3.5 rounded-[16px] px-4 py-4"
          style={{
            background: CREAM_SOFT,
            border: `1px solid ${BORDER}`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
          }}
        >
          <motion.button
            type="button"
            onClick={openAvatarSheet}
            whileTap={{ scale: 0.96 }}
            disabled={avatarBusy}
            aria-label={hasAvatar ? "Change profile photo" : "Add profile photo"}
            className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[16px]"
            style={{
              background: CHARCOAL,
              color: CREAM_SOFT,
              fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full">
              {hasAvatar && avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                initials(seed)
              )}
              <AnimatePresence>
                {avatarBusy && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center rounded-full"
                    style={{ background: "rgba(20,20,20,0.55)", color: CREAM_SOFT }}
                  >
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            {/* Tactile "editable" badge — always visible on mobile so the
                affordance is obvious without hover. */}
            <span
              className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full"
              style={{
                background: CREAM_SOFT,
                border: `1px solid ${BORDER}`,
                color: CHARCOAL,
                boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
              }}
            >
              {avatarBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Pencil className="h-3 w-3" strokeWidth={2} />
              )}
            </span>
          </motion.button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarFile}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div
                className="truncate text-[15px]"
                style={{ color: CHARCOAL, fontWeight: 600, letterSpacing: "-0.01em" }}
              >
                {displayShown}
              </div>
              {activePaidTier && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] uppercase"
                  style={{
                    background: CHARCOAL,
                    color: CREAM_SOFT,
                    letterSpacing: "0.09em",
                    fontWeight: 600,
                  }}
                  aria-label={`${planLabel} member`}
                >
                  <Sparkles className="h-2.5 w-2.5" strokeWidth={2.2} />
                  {planLabel}
                </span>
              )}
            </div>
            <div className="truncate text-[12.5px]" style={{ color: MUTED }}>
              {avatarBusy ? (
                <span className="inline-flex items-center gap-1.5" style={{ color: CHARCOAL }}>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Uploading photo…
                </span>
              ) : (
                user.email
              )}
            </div>
          </div>
        </motion.div>

        <SectionLabel>{t("profile.section.personal", "Personal")}</SectionLabel>
        <SettingsGroup>
          {loading ? (
            <div className="flex items-center justify-center py-6" style={{ color: MUTED }}>
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : editing ? (
            <div className="flex items-center gap-3 px-4 py-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "rgb(var(--aegis-ink-rgb) / 0.05)",
                  color: CHARCOAL,
                  border: `1px solid ${BORDER}`,
                }}
              >
                <User className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <input
                autoFocus
                type="text"
                value={displayName}
                maxLength={64}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("profile.displayName.placeholder", "Your name")}
                className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none"
                style={{ color: CHARCOAL, fontWeight: 500 }}
              />
              <button onClick={cancelEdit} className="text-[12px]" style={{ color: MUTED }}>
                {t("common.cancel", "Cancel")}
              </button>
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={save}
                disabled={saving}
                className="flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-60"
                style={{ background: CHARCOAL, color: CREAM_SOFT }}
                aria-label={t("common.save", "Save")}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                )}
              </motion.button>
            </div>
          ) : (
            <SettingsRow
              icon={<User className="h-4 w-4" strokeWidth={1.8} />}
              title={t("profile.displayName", "Display name")}
              value={initialName || t("profile.displayName.empty", "Not set")}
              onClick={() => setEditing(true)}
              trailing={
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} style={{ color: MUTED }} />
              }
            />
          )}
          <SettingsRow
            icon={<Mail className="h-4 w-4" strokeWidth={1.8} />}
            title={t("profile.email", "Email")}
            value={user.email ?? ""}
          />
        </SettingsGroup>

        {notice && (
          <div className="pt-3">
            <Notice kind={notice.kind}>{notice.text}</Notice>
          </div>
        )}

        <SectionLabel>{t("profile.section.appearance", "Appearance")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            icon={
              themePref === "dark" ? (
                <Moon className="h-4 w-4" strokeWidth={1.8} />
              ) : themePref === "light" ? (
                <Sun className="h-4 w-4" strokeWidth={1.8} />
              ) : (
                <Monitor className="h-4 w-4" strokeWidth={1.8} />
              )
            }
            title={t("profile.theme", "Theme")}
            value={
              themePref === "system"
                ? t("appearance.system", "System")
                : themePref === "light"
                  ? t("appearance.light", "Light")
                  : t("appearance.dark", "Dark")
            }
            onClick={() => setThemeSheet(true)}
            chevron
          />
        </SettingsGroup>

        <SectionLabel>{t("profile.section.language", "Language")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<Globe className="h-4 w-4" strokeWidth={1.8} />}
            title={t("profile.language", "Language")}
            value={
              localePref === "system"
                ? t("language.system", "System")
                : (SUPPORTED_LOCALES.find((l) => l.code === localePref)?.nativeLabel ?? "English")
            }
            onClick={() => setLocaleSheet(true)}
            chevron
          />
        </SettingsGroup>

        <SectionLabel>{t("profile.section.plan", "Plan")}</SectionLabel>
        {isGuestId(user.id) ? (
          <LockedSection
            title={t("profile.plan.locked", "Plan & billing")}
            description={t(
              "profile.plan.locked.description",
              "Upgrade to Pro or Family after you sign in.",
            )}
          />
        ) : (
          <SettingsGroup>
            <SettingsRow
              icon={
                activePaidTier ? (
                  <Sparkles className="h-4 w-4" strokeWidth={1.8} />
                ) : (
                  <CreditCard className="h-4 w-4" strokeWidth={1.8} />
                )
              }
              title={t("profile.plan", "Plan")}
              value={planLabel}
              description={
                activePaidTier
                  ? t("profile.plan.paid.description", "500 accounts · auto backup · breach monitoring.")
                  : t("profile.plan.free.description", "Free — 25 accounts. Upgrade for more.")
              }
              onClick={() => setPlanSheet(true)}
              chevron
            />
            <SettingsRow
              icon={<Eye className="h-4 w-4" strokeWidth={1.8} />}
              title={t("profile.plan.compare", "Compare plans")}
              description={t(
                "profile.plan.compare.description",
                "See what's in Free, Pro, and Family side-by-side.",
              )}
              onClick={() => setCompareSheet(true)}
              chevron
            />
          </SettingsGroup>
        )}

        <SectionLabel>{t("profile.section.sharing", "Sharing")}</SectionLabel>
        {isGuestId(user.id) ? (
          <LockedSection
            title={t("profile.sharing.locked", "Family sharing")}
            description={t(
              "profile.sharing.locked.description",
              "Share codes with up to 6 family members after you sign in.",
            )}
          />
        ) : (
          <SettingsGroup>
            <SettingsRow
              icon={<Users className="h-4 w-4" strokeWidth={1.8} />}
              title={t("profile.family", "Family")}
              description={t(
                "profile.family.description",
                "Share your Aegis codes with up to 6 family members.",
              )}
              onClick={() => navigate({ to: "/family" })}
              chevron
            />
          </SettingsGroup>
        )}

        <SectionLabel>{t("profile.section.support", "Support")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<MessageCircle className="h-4 w-4" strokeWidth={1.8} />}
            title={t("profile.feedback", "Report a problem")}
            description={t(
              "profile.feedback.description",
              "Bugs, ideas, or questions — sent straight to us.",
            )}
            onClick={() => setFeedbackSheet(true)}
            chevron
          />
        </SettingsGroup>

        <SectionLabel>{t("profile.section.session", "Session")}</SectionLabel>
        <SettingsGroup>
          {isGuestId(user.id) ? (
            <SettingsRow
              icon={<LogIn className="h-4 w-4" strokeWidth={1.8} />}
              title={t("profile.signIn", "Sign in")}
              description={t(
                "profile.signIn.description",
                "Enable cloud backup, sync, and family sharing.",
              )}
              onClick={() => navigate({ to: "/auth" })}
              chevron
            />
          ) : (
            <SettingsRow
              icon={<LogOut className="h-4 w-4" strokeWidth={1.8} />}
              title={t("profile.signOut", "Sign out")}
              description={t("profile.signOut.description", "You'll need to sign in and unlock again")}
              onClick={signOut}
              chevron
            />
          )}
        </SettingsGroup>


        <SectionLabel>{t("profile.section.danger", "Danger zone")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<Trash2 className="h-4 w-4" strokeWidth={1.8} />}
            title={deleting ? t("profile.delete.busy", "Deleting account…") : t("profile.delete", "Delete account")}
            description={t("profile.delete.description", "Erase your account, codes, and passphrase forever.")}
            onClick={handleDelete}
            disabled={deleting}
            danger
            chevron
          />
        </SettingsGroup>
      </div>

      <AnimatePresence>
        {avatarSheet && (
          <AvatarActionSheet
            hasAvatar={hasAvatar}
            avatarUrl={avatarUrl}
            seed={seed}
            onChoose={pickAvatarFile}
            onRemove={handleAvatarRemove}
            onClose={() => setAvatarSheet(false)}
          />
        )}
        {themeSheet && (
          <ThemeSheet
            value={themePref}
            onChoose={(p) => {
              chooseTheme(p);
              setThemeSheet(false);
            }}
            onClose={() => setThemeSheet(false)}
          />
        )}
        {localeSheet && (
          <LocaleSheet
            value={localePref}
            onChoose={(p) => {
              chooseLocale(p);
              setLocaleSheet(false);
            }}
            onClose={() => setLocaleSheet(false)}
          />
        )}
        {planSheet && (
          <PlanSheet
            tier={sub?.tier ?? "free"}
            status={sub?.status ?? "active"}
            cancelAtPeriodEnd={sub?.cancel_at_period_end ?? false}
            currentPeriodEnd={sub?.current_period_end ?? null}
            busy={planBusy}
            onUpgrade={(t) => handleUpgrade(t)}
            onManage={handleManage}
            onClose={() => setPlanSheet(false)}
          />
        )}
        {feedbackSheet && <FeedbackSheet onClose={() => setFeedbackSheet(false)} />}
      </AnimatePresence>
      <PlanComparisonSheet open={compareSheet} onClose={() => setCompareSheet(false)} />
      <PremiumWelcomeSheet
        open={welcomeSheet}
        tier={(sub?.tier as "pro" | "family" | undefined) ?? "pro"}
        onClose={() => setWelcomeSheet(false)}
      />
    </>
  );
}


function ThemeRow({
  icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ backgroundColor: "rgb(var(--aegis-ink-rgb) / 0.04)" }}
      className="flex w-full items-center gap-3 px-4 py-3 text-left"
      style={{ borderColor: BORDER }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{
          background: "rgb(var(--aegis-ink-rgb) / 0.05)",
          color: CHARCOAL,
          border: `1px solid ${BORDER}`,
        }}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-[14.5px]"
          style={{ color: CHARCOAL, fontWeight: 500, letterSpacing: "-0.005em" }}
        >
          {title}
        </span>
        <span className="mt-0.5 truncate text-[12.5px] leading-[1.4]" style={{ color: MUTED }}>
          {description}
        </span>
      </div>
      {active && (
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full"
          style={{ background: CHARCOAL, color: CREAM_SOFT }}
          aria-hidden
        >
          <Check className="h-3 w-3" strokeWidth={2.6} />
        </span>
      )}
    </motion.button>
  );
}

function ThemeSheet({
  value,
  onChoose,
  onClose,
}: {
  value: ThemePref;
  onChoose: (pref: ThemePref) => void;
  onClose: () => void;
}) {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string) => {
    const msg = i18n._(id);
    return msg === id ? fallback : msg;
  };
  const options: { pref: ThemePref; icon: React.ReactNode; title: string; description: string }[] = [
    { pref: "system", icon: <Monitor className="h-4 w-4" strokeWidth={1.8} />, title: t("appearance.system", "System"), description: t("appearance.system.description", "Follow your device.") },
    { pref: "light", icon: <Sun className="h-4 w-4" strokeWidth={1.8} />, title: t("appearance.light", "Light"), description: t("appearance.light.description", "Warm cream, always.") },
    { pref: "dark", icon: <Moon className="h-4 w-4" strokeWidth={1.8} />, title: t("appearance.dark", "Dark"), description: t("appearance.dark.description", "Easy on the eyes.") },
  ];
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label={t("common.close", "Close")}
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto w-full max-w-[440px] rounded-t-[22px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div
          className="mx-auto mb-4 h-1 w-10 rounded-full"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.15)" }}
        />
        <div
          className="mb-3 px-1 text-[11px] uppercase"
          style={{ color: MUTED, letterSpacing: "0.14em", fontWeight: 600 }}
        >
          {t("appearance.title", "Appearance")}
        </div>
        <div
          className="overflow-hidden rounded-[16px]"
          style={{ border: `1px solid ${BORDER}`, background: "rgb(var(--aegis-ink-rgb) / 0.02)" }}
        >
          {options.map((opt, i) => (
            <div key={opt.pref}>
              {i > 0 && <div style={{ height: 1, background: BORDER, marginLeft: 60 }} />}
              <ThemeRow
                icon={opt.icon}
                title={opt.title}
                description={opt.description}
                active={value === opt.pref}
                onClick={() => onChoose(opt.pref)}
              />
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-3 w-full rounded-[14px] px-4 py-3 text-[13.5px]"
          style={{ color: MUTED, fontWeight: 500 }}
        >
          {t("common.cancel", "Cancel")}
        </button>
      </motion.div>
    </motion.div>
  );
}

function LocaleSheet({
  value,
  onChoose,
  onClose,
}: {
  value: LocalePref;
  onChoose: (pref: LocalePref) => void;
  onClose: () => void;
}) {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string) => {
    const msg = i18n._(id);
    return msg === id ? fallback : msg;
  };
  type Row = { pref: LocalePref; title: string; description: string };
  const rows: Row[] = [
    { pref: "system", title: t("language.system", "System"), description: t("language.system.description", "Follow your device.") },
    ...SUPPORTED_LOCALES.map((l) => ({
      pref: l.code as LocalePref,
      title: l.nativeLabel,
      description: l.label,
    })),
  ];
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label={t("common.close", "Close")}
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto w-full max-w-[440px] rounded-t-[22px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div
          className="mx-auto mb-4 h-1 w-10 rounded-full"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.15)" }}
        />
        <div
          className="mb-3 px-1 text-[11px] uppercase"
          style={{ color: MUTED, letterSpacing: "0.14em", fontWeight: 600 }}
        >
          {t("language.title", "Language")}
        </div>
        <div
          className="max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-[16px]"
          style={{ border: `1px solid ${BORDER}`, background: "rgb(var(--aegis-ink-rgb) / 0.02)" }}
        >
          {rows.map((opt, i) => (
            <div key={String(opt.pref)}>
              {i > 0 && <div style={{ height: 1, background: BORDER, marginLeft: 60 }} />}
              <ThemeRow
                icon={<Globe className="h-4 w-4" strokeWidth={1.8} />}
                title={opt.title}
                description={opt.description}
                active={value === opt.pref}
                onClick={() => onChoose(opt.pref)}
              />
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-3 w-full rounded-[14px] px-4 py-3 text-[13.5px]"
          style={{ color: MUTED, fontWeight: 500 }}
        >
          {t("common.cancel", "Cancel")}
        </button>
      </motion.div>
    </motion.div>
  );
}





function AvatarActionSheet({
  hasAvatar,
  avatarUrl,
  seed,
  onChoose,
  onRemove,
  onClose,
}: {
  hasAvatar: boolean;
  avatarUrl: string | null;
  seed: string;
  onChoose: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string) => {
    const msg = i18n._(id);
    return msg === id ? fallback : msg;
  };
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label={t("common.close", "Close")}
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto w-full max-w-[440px] rounded-t-[22px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        {/* grabber */}
        <div
          className="mx-auto mb-4 h-1 w-10 rounded-full"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.15)" }}
        />

        <div className="flex flex-col items-center gap-3 pb-4">
          <div
            className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full text-[17px]"
            style={{
              background: CHARCOAL,
              color: CREAM_SOFT,
              fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            {hasAvatar && avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              (() => {
                const parts = seed
                  .trim()
                  .split(/[\s._@-]+/)
                  .filter(Boolean);
                const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : seed.slice(0, 2);
                return chars.toUpperCase() || "?";
              })()
            )}
          </div>
          <div
            className="text-[15px]"
            style={{
              fontWeight: 600,
              color: CHARCOAL,
              letterSpacing: "-0.01em",
            }}
          >
            {t("profile.photo.title", "Profile photo")}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <motion.button
            whileTap={{ scale: 0.985 }}
            onClick={onChoose}
            className="flex items-center gap-3 rounded-[14px] px-4 py-3.5 text-left"
            style={{
              background: CHARCOAL,
              color: CREAM_SOFT,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
          >
            <Camera className="h-4 w-4" strokeWidth={1.8} />
            <span className="text-[14px]" style={{ fontWeight: 500 }}>
              {hasAvatar ? t("profile.photo.chooseNew", "Choose a new photo") : t("profile.photo.choose", "Choose a photo")}
            </span>
          </motion.button>

          {hasAvatar && (
            <motion.button
              whileTap={{ scale: 0.985 }}
              onClick={onRemove}
              className="flex items-center gap-3 rounded-[14px] px-4 py-3.5 text-left"
              style={{
                background: "transparent",
                color: DANGER,
                border: `1px solid ${BORDER}`,
              }}
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              <span className="text-[14px]" style={{ fontWeight: 500 }}>
                {t("profile.photo.remove", "Remove current photo")}
              </span>
            </motion.button>
          )}

          <button
            onClick={onClose}
            className="mt-1 rounded-[14px] px-4 py-3 text-[13.5px]"
            style={{ color: MUTED, fontWeight: 500 }}
          >
            {t("common.cancel", "Cancel")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function PlanSheet({
  tier,
  status,
  cancelAtPeriodEnd,
  currentPeriodEnd,
  busy,
  onUpgrade,
  onManage,
  onClose,
}: {
  tier: "free" | "pro" | "family";
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  busy: null | "pro" | "family" | "portal";
  onUpgrade: (tier: "pro" | "family") => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string, values?: Record<string, unknown>) => {
    const msg = values ? i18n._(id, values) : i18n._(id);
    return msg === id ? fallback : msg;
  };
  const isPaid = tier !== "free" && ["active", "trialing"].includes(status);
  const renews = currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : null;
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label={t("common.close", "Close")}
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto w-full max-w-[440px] rounded-t-[22px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div
          className="mx-auto mb-4 h-1 w-10 rounded-full"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.15)" }}
        />
        <div
          className="mb-3 px-1 text-[11px] uppercase"
          style={{ color: MUTED, letterSpacing: "0.14em", fontWeight: 600 }}
        >
          {t("plan.sheet.title", "Plan & billing")}
        </div>

        {isPaid ? (
          <div className="flex flex-col gap-3 px-1 pb-2">
            <div className="rounded-[14px] px-4 py-3.5" style={{ border: `1px solid ${BORDER}` }}>
              <div className="text-[14.5px]" style={{ color: CHARCOAL, fontWeight: 600 }}>
                {tier === "family" ? t("plan.name.family", "Aegis Family") : t("plan.name.pro", "Aegis Pro")} · {status}
              </div>
              <div className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
                {t("plan.paid.description", "Up to 500 accounts.")}{" "}
                {renews
                  ? cancelAtPeriodEnd
                    ? t("plan.paid.ends", `Ends ${renews}.`, { date: renews })
                    : t("plan.paid.renews", `Renews ${renews}.`, { date: renews })
                  : ""}
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.985 }}
              onClick={onManage}
              disabled={busy !== null}
              className="flex items-center justify-center gap-2 rounded-[14px] px-4 py-3.5 text-[14px] disabled:opacity-60"
              style={{ background: CHARCOAL, color: CREAM_SOFT, fontWeight: 500 }}
            >
              {busy === "portal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" strokeWidth={1.8} />}
              {t("plan.manageBilling", "Manage billing")}
            </motion.button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 px-1 pb-1">
            <div className="rounded-[14px] px-4 py-3.5" style={{ border: `1px solid ${BORDER}` }}>
              <div className="text-[14.5px]" style={{ color: CHARCOAL, fontWeight: 600 }}>
                {t("plan.tier.free", "Free")}
              </div>
              <div className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
                {t("plan.free.description", "Up to 25 accounts. Encrypted sync included.")}
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.985 }}
              onClick={() => onUpgrade("pro")}
              disabled={busy !== null}
              className="flex items-center justify-between gap-3 rounded-[14px] px-4 py-3.5 text-left disabled:opacity-60"
              style={{ background: CHARCOAL, color: CREAM_SOFT }}
            >
              <div className="flex flex-col">
                <span className="text-[14px]" style={{ fontWeight: 600 }}>
                  {t("plan.upgradePro", "Upgrade to Pro")}
                </span>
                <span className="text-[12px] opacity-80">{t("plan.upgradePro.description", "Up to 500 accounts.")}</span>
              </div>
              {busy === "pro" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" strokeWidth={1.8} />
              )}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.985 }}
              onClick={() => onUpgrade("family")}
              disabled={busy !== null}
              className="flex items-center justify-between gap-3 rounded-[14px] px-4 py-3.5 text-left disabled:opacity-60"
              style={{ background: "transparent", color: CHARCOAL, border: `1px solid ${BORDER}` }}
            >
              <div className="flex flex-col">
                <span className="text-[14px]" style={{ fontWeight: 600 }}>
                  {t("plan.upgradeFamily", "Upgrade to Family")}
                </span>
                <span className="text-[12px]" style={{ color: MUTED }}>
                  {t("plan.upgradeFamily.description", "Everything in Pro + share with up to 6 members.")}
                </span>
              </div>
              {busy === "family" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Users className="h-4 w-4" strokeWidth={1.8} />
              )}
            </motion.button>
          </div>
        )}
        <button
          onClick={onClose}
          className="mt-3 w-full rounded-[14px] px-4 py-3 text-[13.5px]"
          style={{ color: MUTED, fontWeight: 500 }}
        >
          {t("common.close", "Close")}
        </button>
      </motion.div>
    </motion.div>
  );
}
