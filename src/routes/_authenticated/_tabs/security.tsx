import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { SharingSection } from "@/components/aegis/sharing-section";
import {
  KeyRound,
  RotateCcw,
  Timer,
  Sparkles,
  Lock,
  ShieldCheck,
  Check,
  X,
  FileText,
  EyeOff,
  Fingerprint,
  Download,
  Cloud,
  CloudUpload,
  Trash2,
  RefreshCw,
  CalendarClock,
  ShieldOff,

} from "lucide-react";

import { DevicesSection } from "@/components/aegis/devices-section";
import { ExtensionSyncSection } from "@/components/aegis/extension-sync-section";
import { ExtensionTrustSection } from "@/components/aegis/extension-trust-section";
import { ApprovalSection } from "@/components/aegis/approval-section";
import { SignInHistorySection } from "@/components/aegis/signin-history-section";
import { VaultHealthHero } from "@/components/aegis/vault-health-hero";
import { VaultHealthTips } from "@/components/aegis/vault-health-tips";

import { Switch } from "@/components/ui/switch";
import { setHideCodes, useHideCodes } from "@/lib/vault-privacy";
import {
  BORDER,
  CHARCOAL,
  CREAM_SOFT,
  MUTED,
  Notice,
  PrimaryButton,
  soft,
} from "@/components/aegis/chrome";
import { LargeTitle, SectionLabel, SettingsGroup, SettingsRow } from "@/components/aegis/settings";
import { useLingui } from "@lingui/react";
import { PasswordField, StrengthMeter, ZxcvbnMeter, scoreStrength } from "@/components/aegis/password-field";
import {
  AUTO_LOCK_OPTIONS,
  getAutoLockMs,
  getVaultKey,
  isVaultUnlocked,
  lockVault,
  setAutoLockMs,
  setVaultKey,
  useAutoLockMs,
} from "@/lib/vault-session";
import {

  rewrapVaultKey,
  toBytes,
  toByteaHex,
  unwrapVaultKey,
} from "@/lib/vault-crypto";
import {
  disableBiometric,
  enrollBiometric,
  isBiometricEnabled,
  isBiometricSupported,
} from "@/lib/biometric";
import {
  isAutoUnlockEnabled,
  enableAutoUnlock,
  disableAutoUnlock,
} from "@/lib/auto-unlock";
import { listAccounts } from "@/lib/vault-accounts";
import { buildEncryptedExport, downloadExport } from "@/lib/vault-export";
import {
  deleteCloudBackup,
  formatBackupSize,
  listCloudBackups,
  restoreCloudBackup,
  uploadCloudBackup,
  type CloudBackupEntry,
} from "@/lib/vault-cloud-backup";
import {
  clearAutoBackupLog,
  disableAutoBackup,
  enableAutoBackup,
  friendlyBackupError,
  getAutoBackupLog,
  getAutoBackupSettings,
  hasStoredPassphrase,
  initAutoBackup,
  runAutoBackupNow,
  setAutoBackupPlanGate,
  subscribeAutoBackup,
  updateAutoBackupSettings,
  type AutoBackupFrequency,
  type AutoBackupLogEntry,
  type AutoBackupSettings,
} from "@/lib/vault-autobackup";
import { usePlan } from "@/hooks/use-plan";

export const Route = createFileRoute("/_authenticated/_tabs/security")({
  beforeLoad: ({ location }) => {
    if (!isVaultUnlocked()) {
      throw redirect({ to: "/lock", search: { redirect: location.href } });
    }
  },
  head: () => ({
    meta: [
      { title: "Security — Aegis" },
      {
        name: "description",
        content:
          "Change your passphrase, review recovery, and export an encrypted backup of your Aegis vault.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Security — Aegis" },
      {
        property: "og:description",
        content: "Passphrase, recovery, and encrypted backup for your Aegis vault.",
      },
      { property: "og:url", content: "https://aegis-v2.flinkeo.online/security" },
    ],
  }),
  component: SecurityPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});


function autoLockLabel(ms: number | null): string {
  const opt = AUTO_LOCK_OPTIONS.find((o) => o.value === ms);
  return opt ? opt.label : "After 5 minutes of inactivity";
}

function SecurityPage() {
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();
  const { i18n } = useLingui();
  const t = (id: string, fallback: string) => {
    const msg = i18n._(id);
    return msg === id ? fallback : msg;
  };
  const autoLockMs = useAutoLockMs();
  const plan = usePlan();
  const canAutoBackup = plan.hasFeature("auto-cloud-backup");
  const hideCodes = useHideCodes();
  const [hint, setHint] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoLockOpen, setAutoLockOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [cloudBackupOpen, setCloudBackupOpen] = useState(false);
  const [autoBackupOpen, setAutoBackupOpen] = useState(false);
  const [autoBackup, setAutoBackup] = useState<AutoBackupSettings>(() =>
    getAutoBackupSettings(user.id),
  );
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState<boolean>(() => isBiometricEnabled(user.id));
  const [bioBusy, setBioBusy] = useState(false);
  const [autoUnlock, setAutoUnlock] = useState<boolean>(() => isAutoUnlockEnabled(user.id));
  const [autoUnlockBusy, setAutoUnlockBusy] = useState(false);

  const toggleAutoUnlock = async (next: boolean) => {
    if (autoUnlockBusy) return;
    setAutoUnlockBusy(true);
    setNotice(null);
    try {
      if (next) {
        const confirmed = window.confirm(
          "Turn off passphrase unlock?\n\nThe vault will open on this device without asking for your passphrase, PIN or biometric. Anyone with access to this browser will be able to read your codes.\n\nContinue?",
        );
        if (!confirmed) {
          setAutoUnlockBusy(false);
          return;
        }
        const dek = getVaultKey();
        if (!dek) throw new Error("Unlock the vault first, then turn this on.");
        await enableAutoUnlock(user.id, dek);
        setAutoUnlock(true);
        setNotice({
          kind: "info",
          text: "Passphrase unlock is off on this device. The vault will open automatically.",
        });
      } else {
        disableAutoUnlock(user.id);
        setAutoUnlock(false);
        setNotice({
          kind: "info",
          text: "Passphrase unlock is back on. You'll be asked next time this device opens the vault.",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update this setting.";
      setNotice({ kind: "error", text: msg });
      setAutoUnlock(isAutoUnlockEnabled(user.id));
    } finally {
      setAutoUnlockBusy(false);
    }
  };


  useEffect(() => {
    let cancelled = false;
    supabase
      .from("vault_meta")
      .select("passphrase_hint")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setHint(data?.passphrase_hint ?? null);
      });
    void isBiometricSupported().then((ok) => {
      if (!cancelled) setBioSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // Boot the auto-backup scheduler for this user; refresh UI on settings/status changes.
  // Also surface success/error events as toast notifications so the user gets feedback
  // even when the Auto-backup sheet is closed.
  useEffect(() => {
    setAutoBackupPlanGate(canAutoBackup);
  }, [canAutoBackup]);

  useEffect(() => {
    initAutoBackup(user.id);
    setAutoBackup(getAutoBackupSettings(user.id));
    // Seed the "last seen" cursor with the newest existing entry so we don't
    // toast historical events on mount / navigation.
    let lastSeen = getAutoBackupLog(user.id)[0]?.at ?? "";
    const unsub = subscribeAutoBackup(user.id, () => {
      setAutoBackup(getAutoBackupSettings(user.id));
      const log = getAutoBackupLog(user.id);
      const fresh: AutoBackupLogEntry[] = [];
      for (const entry of log) {
        if (entry.at === lastSeen) break;
        fresh.push(entry);
      }
      if (log.length > 0) lastSeen = log[0].at;
      // Oldest → newest so toast stack order matches event order.
      for (const entry of fresh.reverse()) {
        if (entry.kind === "success") {
          toast.success("Encrypted backup uploaded", {
            description: entry.message ?? "Your vault is safely backed up to the cloud.",
          });
        } else if (entry.kind === "error") {
          toast.error("Auto-backup failed", {
            description: entry.message ?? "We'll retry on the next vault change.",
          });
        }
      }
    });
    return () => {
      unsub();
    };
  }, [user.id]);

  const toggleBiometric = async (next: boolean) => {
    if (bioBusy) return;
    setBioBusy(true);
    setNotice(null);
    try {
      if (next) {
        const dek = getVaultKey();
        if (!dek) throw new Error("Vault is locked. Unlock first to enable biometrics.");
        await enrollBiometric({ userId: user.id, userEmail: user.email ?? user.id, dek });
        setBioEnrolled(true);
        setNotice({ kind: "info", text: "Biometric unlock enabled on this device." });
      } else {
        const result = disableBiometric(user.id);
        // Re-read from storage as an independent second check.
        const stillEnrolled = isBiometricEnabled(user.id);
        if (result.removed && !stillEnrolled) {
          setBioEnrolled(false);
          setNotice({
            kind: "info",
            text: "Biometric unlock removed from this device. Passphrase will be required next time.",
          });
        } else {
          setBioEnrolled(stillEnrolled);
          setNotice({
            kind: "error",
            text:
              "Couldn't remove biometric unlock from this device" +
              (result.error ? ` — ${result.error}` : ".") +
              " Try again, or clear site data for this app.",
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update biometric setting.";
      setNotice({ kind: "error", text: msg });
      setBioEnrolled(isBiometricEnabled(user.id));
    } finally {
      setBioBusy(false);
    }
  };

  const lockNow = () => {
    lockVault();
    navigate({ to: "/lock", replace: true });
  };

  const resetVault = async () => {
    const ok = window.confirm(
      "Reset your vault?\n\nThis erases your saved passphrase and every stored code. Only do this if you've lost access.",
    );
    if (!ok) return;
    setBusy(true);
    setNotice(null);
    try {
      await supabase.from("vault_accounts").delete().eq("user_id", user.id);
      await supabase.from("vault_meta").delete().eq("user_id", user.id);
      disableAutoUnlock(user.id);
      setAutoUnlock(false);
      lockVault();
      navigate({ to: "/lock", replace: true });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Reset failed." });
    } finally {
      setBusy(false);
    }
  };

  const currentAutoLockLabel = useMemo(() => autoLockLabel(autoLockMs), [autoLockMs]);

  return (
    <>
      <LargeTitle
        title={t("security.title", "Locks & recovery")}
        subtitle={t("security.subtitle", "Everything protecting your codes lives here.")}
      />

      <div className="flex flex-col gap-1 pt-1">
        <VaultHealthHero />
        <VaultHealthTips />

        <SectionLabel>{t("security.section.vault", "Vault")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<KeyRound className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.passphraseHint", "Passphrase hint")}
            value={hint ?? t("security.passphraseHint.empty", "No hint set")}
          />
          <SettingsRow
            icon={<Timer className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.autoLock", "Auto-lock")}
            value={currentAutoLockLabel}
            onClick={() => setAutoLockOpen(true)}
            chevron
          />

          <SettingsRow
            icon={<Sparkles className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.changePassphrase", "Change passphrase")}
            description={t("security.changePassphrase.description", "Rotate your master key without re-adding accounts")}
            onClick={() => setChangeOpen(true)}
            chevron
          />
          <SettingsRow
            icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.recoverySheet", "Recovery sheet")}
            description={t("security.recoverySheet.description", "Printable backup — accounts list + wrapped key QR")}
            onClick={() => navigate({ to: "/vault/recovery" })}
            chevron
          />
          <SettingsRow
            icon={<Download className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.encryptedExport", "Encrypted export")}
            description={t("security.encryptedExport.description", "Download a passphrase-protected .avf backup file")}
            onClick={() => setExportOpen(true)}
            chevron
          />
          <SettingsRow
            icon={<Cloud className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.cloudBackup", "Encrypted cloud backup")}
            description={t("security.cloudBackup.description", "Store passphrase-wrapped .avf files in your private cloud folder")}
            onClick={() => setCloudBackupOpen(true)}
            chevron
          />
          <SettingsRow
            icon={<CalendarClock className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.autoBackup", "Scheduled auto-backup")}
            value={
              canAutoBackup
                ? autoBackupSummary(autoBackup)
                : t("security.autoBackup.proOnly", "Pro — upgrade to enable")
            }
            onClick={() => {
              if (canAutoBackup) {
                setAutoBackupOpen(true);
              } else {
                toast.info("Scheduled auto-backup is a Pro feature", {
                  description: "Upgrade to Pro or Family to enable daily encrypted backups.",
                });
                void navigate({ to: "/profile", hash: "plan" });
              }
            }}
            chevron
          />

        </SettingsGroup>




        <SectionLabel>{t("security.section.signIn", "Sign-in")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<Fingerprint className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.biometric", "Biometric unlock")}
            description={
              !bioSupported
                ? "Not available on this device or browser."
                : bioEnrolled
                  ? "Use Face ID, Touch ID, or Windows Hello to unlock."
                  : "Skip typing your passphrase on trusted devices."
            }
            onClick={
              bioSupported && !bioBusy ? () => void toggleBiometric(!bioEnrolled) : undefined
            }
            disabled={!bioSupported || bioBusy}
            trailing={
              <Switch
                checked={bioEnrolled}
                disabled={!bioSupported || bioBusy}
                onCheckedChange={(v) => void toggleBiometric(v)}
                onClick={(e) => e.stopPropagation()}
                aria-label="Biometric unlock"
              />
            }
          />
          <SettingsRow
            icon={<ShieldOff className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.autoUnlock", "Passphrase unlock")}
            description={
              autoUnlock
                ? "Off — this device opens the vault automatically without asking."
                : "On — passphrase, PIN or biometric is required to open the vault."
            }
            onClick={autoUnlockBusy ? undefined : () => void toggleAutoUnlock(!autoUnlock)}
            disabled={autoUnlockBusy}
            trailing={
              <Switch
                checked={!autoUnlock}
                disabled={autoUnlockBusy}
                onCheckedChange={(v) => void toggleAutoUnlock(!v)}
                onClick={(e) => e.stopPropagation()}
                aria-label="Passphrase unlock"
              />
            }
          />
        </SettingsGroup>

        <SectionLabel>{t("security.section.devices", "Devices")}</SectionLabel>
        <DevicesSection heading={t("security.devices", "Devices")} />
        <SignInHistorySection heading={t("security.signInHistory", "Sign-in history")} />

        <ExtensionSyncSection />
        <ExtensionTrustSection />
        <ApprovalSection />

        <SharingSection />








        <SectionLabel>{t("security.section.privacy", "Privacy")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<EyeOff className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.hideCodes", "Hide codes")}
            description={
              hideCodes
                ? t("security.hideCodes.on", "Codes stay masked. Tap an account to reveal or copy.")
                : t("security.hideCodes.off", "Codes are visible in the vault at a glance.")
            }
            onClick={() => {
              const next = !hideCodes;
              setHideCodes(next);
              setNotice({
                kind: "info",
                text: next ? "Codes are now hidden by default." : "Codes are now visible.",
              });
            }}
            trailing={
              <Switch
                checked={hideCodes}
                onCheckedChange={(v) => {
                  setHideCodes(v);
                  setNotice({
                    kind: "info",
                    text: v ? "Codes are now hidden by default." : "Codes are now visible.",
                  });
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label="Hide codes by default"
              />
            }
          />
        </SettingsGroup>

        <SectionLabel>{t("security.section.session", "Session")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<Lock className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.lockNow", "Lock vault now")}
            description={t("security.lockNow.description", "Require your passphrase to open again")}
            onClick={lockNow}
            chevron
          />
        </SettingsGroup>

        <SectionLabel>{t("security.section.danger", "Danger zone")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<RotateCcw className="h-4 w-4" strokeWidth={1.8} />}
            title={t("security.reset", "Reset vault")}
            description={t("security.reset.description", "Erase everything. This cannot be undone.")}
            onClick={resetVault}
            disabled={busy}
            danger
            chevron
          />
        </SettingsGroup>

        {notice && (
          <div className="pt-3">
            <Notice kind={notice.kind}>{notice.text}</Notice>
          </div>
        )}

        <p
          className="pt-6 text-center text-[11px]"
          style={{ color: MUTED, letterSpacing: "0.02em" }}
        >
          Codes are encrypted on your device. We can't read them.
        </p>
      </div>

      <AnimatePresence>
        {autoLockOpen && (
          <AutoLockSheet
            current={autoLockMs}
            onClose={() => setAutoLockOpen(false)}
            onPick={(opt) => {
              setAutoLockMs(opt.value);
              setAutoLockOpen(false);
              setNotice({ kind: "info", text: `Auto-lock set to “${opt.label.toLowerCase()}”.` });
            }}
          />
        )}
        {changeOpen && (
          <ChangePassphraseSheet
            userId={user.id}
            initialHint={hint}
            onClose={() => setChangeOpen(false)}
            onSaved={(nextHint) => {
              setHint(nextHint);
              setChangeOpen(false);
              setNotice({ kind: "info", text: "Passphrase updated." });
            }}
          />
        )}
        {exportOpen && (
          <ExportSheet
            onClose={() => setExportOpen(false)}
            onDone={(count) => {
              setExportOpen(false);
              setNotice({
                kind: "info",
                text: `Encrypted export downloaded (${count} ${count === 1 ? "account" : "accounts"}).`,
              });
            }}
          />
        )}
        {cloudBackupOpen && (
          <CloudBackupSheet
            userId={user.id}
            onClose={() => setCloudBackupOpen(false)}
            onNotice={(n) => setNotice(n)}
          />
        )}
        {autoBackupOpen && (
          <AutoBackupSheet
            userId={user.id}
            settings={autoBackup}
            onClose={() => setAutoBackupOpen(false)}
            onNotice={(n) => setNotice(n)}
          />
        )}

      </AnimatePresence>
    </>
  );
}

function ChangePassphraseSheet({
  userId,
  initialHint,
  onClose,
  onSaved,
}: {
  userId: string;
  initialHint: string | null;
  onClose: () => void;
  onSaved: (hint: string | null) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [hint, setHint] = useState(initialHint ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // zxcvbn score for the new passphrase; refuse anything under 3 (Strong).
  const [zScore, setZScore] = useState<0 | 1 | 2 | 3 | 4>(0);

  const canSubmit =
    current.length > 0 &&
    next.length >= 10 &&
    zScore >= 3 &&
    next === confirm &&
    next !== current;


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!canSubmit) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("vault_meta")
        .select("kdf_salt, recovery_wrapped_key, recovery_wrapped_key_iv, kdf_algorithm")
        .eq("user_id", userId)
        .single();
      if (error) throw error;
      const currentAlgo = data.kdf_algorithm;
      const currentSalt = toBytes(data.kdf_salt);
      const currentWrapped = toBytes(data.recovery_wrapped_key);
      const currentIv = toBytes(data.recovery_wrapped_key_iv);
      // Verify current passphrase actually unwraps the DEK.
      try {
        await unwrapVaultKey(current, currentSalt, currentWrapped, currentIv, currentAlgo);
      } catch {
        throw new Error("Current passphrase is incorrect.");
      }
      // Rotate: same DEK, new KEK + salt + iv. Output always uses the
      // current default KDF (Argon2id v2), so a v1 vault is upgraded as
      // a side effect of any passphrase change.
      const { salt, wrappedKey, wrappedKeyIv, kdfAlgorithm } = await rewrapVaultKey(
        current,
        next,
        currentSalt,
        currentWrapped,
        currentIv,
        currentAlgo,
      );
      const trimmedHint = hint.trim() ? hint.trim() : null;
      const { error: upErr } = await supabase
        .from("vault_meta")
        .update({
          kdf_salt: toByteaHex(salt),
          kdf_algorithm: kdfAlgorithm,
          recovery_wrapped_key: toByteaHex(wrappedKey),
          recovery_wrapped_key_iv: toByteaHex(wrappedKeyIv),
          passphrase_hint: trimmedHint,
        })
        .eq("user_id", userId);
      if (upErr) throw upErr;
      // Re-unlock with the new passphrase so the in-memory DEK stays valid.
      const freshDek = await unwrapVaultKey(next, salt, wrappedKey, wrappedKeyIv, kdfAlgorithm);
      setVaultKey(freshDek);
      onSaved(trimmedHint);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not change passphrase.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label="Close"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto w-full max-w-[440px] rounded-t-[22px] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-5 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div
              className="text-[18px]"
              style={{
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: CHARCOAL,
              }}
            >
              Change passphrase
            </div>
            <div className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
              Your codes stay put. Only the key that unlocks them changes.
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </motion.button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <PasswordField
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            placeholder="Current passphrase"
            autoFocus
          />
          <PasswordField
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            minLength={10}
            placeholder="New passphrase"
            delay={0.05}
          />
          <ZxcvbnMeter value={next} onScore={setZScore} minScore={3} />
          <PasswordField
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            minLength={10}
            placeholder="Confirm new passphrase"
            delay={0.1}
          />
          <input
            type="text"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            maxLength={80}
            placeholder="Optional hint (never the passphrase)"
            className="rounded-[10px] border bg-transparent px-3 py-2.5 text-[13.5px] outline-none"
            style={{ borderColor: BORDER, color: CHARCOAL }}
          />

          {err && <Notice kind="error">{err}</Notice>}
          {next && next === current && (
            <Notice kind="error">The new passphrase must be different.</Notice>
          )}

          <div className="pt-1">
            <PrimaryButton type="submit" loading={saving} disabled={!canSubmit}>
              Update passphrase
            </PrimaryButton>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

type AutoLockOption = (typeof AUTO_LOCK_OPTIONS)[number];

function AutoLockSheet({
  current,
  onClose,
  onPick,
}: {
  current: number | null;
  onClose: () => void;
  onPick: (opt: AutoLockOption) => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label="Close"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
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
          aria-hidden
          className="mx-auto mb-3 h-[4px] w-10 rounded-full"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.15)" }}
        />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-[18px]"
              style={{
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: CHARCOAL,
              }}
            >
              Auto-lock
            </div>
            <div className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
              Lock the vault after a period of inactivity.
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </motion.button>
        </div>

        <div className="flex flex-col gap-1 pb-1">
          {AUTO_LOCK_OPTIONS.map((opt, i) => {
            const active = opt.value === current;
            return (
              <motion.button
                key={opt.label}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...soft, delay: 0.02 * i }}
                whileTap={{ scale: 0.99 }}
                onClick={() => onPick(opt)}
                className="flex items-center justify-between rounded-[14px] px-4 py-3.5 text-left"
                style={{
                  background: active ? CHARCOAL : "rgb(var(--aegis-ink-rgb) / 0.03)",
                  color: active ? CREAM_SOFT : CHARCOAL,
                  border: `1px solid ${active ? "transparent" : BORDER}`,
                }}
              >
                <span
                  className="text-[14px]"
                  style={{ fontWeight: active ? 600 : 500, letterSpacing: "-0.005em" }}
                >
                  {opt.label}
                </span>
                {active && (
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full"
                    style={{ background: "rgba(255,255,255,0.14)" }}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

function ExportSheet({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit =
    passphrase.length >= 10 && scoreStrength(passphrase) >= 2 && passphrase === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!canSubmit) return;
    const dek = getVaultKey();
    if (!dek) {
      setErr("Vault is locked. Unlock first.");
      return;
    }
    setBusy(true);
    try {
      const accounts = await listAccounts(dek);
      if (accounts.length === 0) {
        setErr("Your vault is empty — nothing to export.");
        return;
      }
      const file = await buildEncryptedExport(accounts, passphrase);
      downloadExport(file);
      onDone(accounts.length);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not build export.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label="Close"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto w-full max-w-[440px] rounded-t-[22px] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-5 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div
              className="text-[18px]"
              style={{
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: CHARCOAL,
              }}
            >
              Encrypted export
            </div>
            <div className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
              Pick a passphrase for this backup file. You'll need it to restore.
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </motion.button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <PasswordField
            value={passphrase}
            onChange={setPassphrase}
            autoComplete="new-password"
            minLength={10}
            placeholder="Export passphrase"
            autoFocus
          />
          <StrengthMeter value={passphrase} />
          <PasswordField
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            minLength={10}
            placeholder="Confirm passphrase"
            delay={0.05}
          />

          {err && <Notice kind="error">{err}</Notice>}

          <div className="pt-1">
            <PrimaryButton type="submit" loading={busy} disabled={!canSubmit}>
              Download .avf backup
            </PrimaryButton>
          </div>

          <p className="pt-1 text-[11.5px]" style={{ color: MUTED, lineHeight: 1.5 }}>
            The file is encrypted end-to-end with AES-256-GCM. Lose the passphrase and the backup is unrecoverable.
          </p>
        </form>
      </motion.div>
    </motion.div>
  );
}

type NoticeKind = { kind: "error" | "info"; text: string };

function CloudBackupSheet({
  userId,
  onClose,
  onNotice,
}: {
  userId: string;
  onClose: () => void;
  onNotice: (n: NoticeKind) => void;
}) {
  const [entries, setEntries] = useState<CloudBackupEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [label, setLabel] = useState("manual");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<CloudBackupEntry | null>(null);
  const [restorePass, setRestorePass] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreErr, setRestoreErr] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setListErr(null);
    try {
      const rows = await listCloudBackups(userId);
      setEntries(rows);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Could not load cloud backups.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const canUpload =
    passphrase.length >= 10 && scoreStrength(passphrase) >= 2 && passphrase === confirm;

  const doUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadErr(null);
    if (!canUpload) return;
    const dek = getVaultKey();
    if (!dek) {
      setUploadErr("Vault is locked. Unlock first.");
      return;
    }
    setUploadBusy(true);
    try {
      const accounts = await listAccounts(dek);
      const entry = await uploadCloudBackup(userId, accounts, passphrase, { label });
      setEntries((prev) => [entry, ...(prev ?? [])]);
      setPassphrase("");
      setConfirm("");
      setUploadOpen(false);
      onNotice({
        kind: "info",
        text: `Uploaded backup (${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}).`,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Upload failed.";
      setUploadErr(friendlyBackupError(raw));
    } finally {
      setUploadBusy(false);
    }
  };

  const doDelete = async (entry: CloudBackupEntry) => {
    const ok = window.confirm(`Delete this cloud backup?\n\n${entry.fileName}`);
    if (!ok) return;
    setDeletingPath(entry.name);
    try {
      await deleteCloudBackup(entry.name);
      setEntries((prev) => (prev ?? []).filter((e) => e.name !== entry.name));
      onNotice({ kind: "info", text: "Backup deleted." });
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : "Delete failed." });
    } finally {
      setDeletingPath(null);
    }
  };

  const doRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreTarget) return;
    setRestoreErr(null);
    const dek = getVaultKey();
    if (!dek) {
      setRestoreErr("Vault is locked. Unlock first.");
      return;
    }
    setRestoreBusy(true);
    try {
      const summary = await restoreCloudBackup(restoreTarget.name, restorePass, dek, userId);
      setRestoreTarget(null);
      setRestorePass("");
      onClose();
      onNotice({
        kind: "info",
        text: `Restored ${summary.restored} · skipped ${summary.skipped}${summary.failed ? ` · failed ${summary.failed}` : ""}.`,
      });
    } catch (err) {
      setRestoreErr(err instanceof Error ? err.message : "Restore failed.");
    } finally {
      setRestoreBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label="Close"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto flex max-h-[85vh] w-full max-w-[480px] flex-col rounded-t-[22px] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-5 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div
              className="text-[18px]"
              style={{
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: CHARCOAL,
              }}
            >
              Encrypted cloud backup
            </div>
            <div className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
              Same AES-256-GCM envelope as the .avf export. We never see the passphrase.
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </motion.button>
        </div>

        <div className="mb-3 flex gap-2">
          <PrimaryButton onClick={() => setUploadOpen((v) => !v)}>
            <CloudUpload className="mr-1.5 inline h-4 w-4" strokeWidth={1.8} />
            {uploadOpen ? "Cancel" : "New backup"}
          </PrimaryButton>
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} strokeWidth={1.8} />
          </button>
        </div>

        {uploadOpen && (
          <form onSubmit={doUpload} className="mb-4 flex flex-col gap-2.5">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. before-cleanup)"
              className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none"
              style={{ borderColor: BORDER, background: CREAM_SOFT, color: CHARCOAL }}
            />
            <PasswordField
              value={passphrase}
              onChange={setPassphrase}
              autoComplete="new-password"
              minLength={10}
              placeholder="Backup passphrase"
            />
            <StrengthMeter value={passphrase} />
            <PasswordField
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              minLength={10}
              placeholder="Confirm passphrase"
              delay={0.05}
            />
            {uploadErr && <Notice kind="error">{uploadErr}</Notice>}
            <PrimaryButton type="submit" loading={uploadBusy} disabled={!canUpload}>
              Upload to cloud
            </PrimaryButton>
            <p className="text-[11px]" style={{ color: MUTED, lineHeight: 1.5 }}>
              Lose the passphrase and this backup is unrecoverable — we can't reset it for you.
            </p>
          </form>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {listErr && <Notice kind="error">{listErr}</Notice>}
          {!loading && entries && entries.length === 0 && !listErr && (
            <div
              className="rounded-xl border px-4 py-6 text-center text-[12.5px]"
              style={{ borderColor: BORDER, color: MUTED }}
            >
              No cloud backups yet. Upload one to keep an off-device copy.
            </div>
          )}
          {entries && entries.length > 0 && (
            <ul className="flex flex-col gap-2">
              {entries.map((e) => (
                <li
                  key={e.name}
                  className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
                  style={{ borderColor: BORDER, background: CREAM_SOFT }}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[13px]"
                      style={{ color: CHARCOAL, fontWeight: 500 }}
                    >
                      {e.fileName}
                    </div>
                    <div className="text-[11px]" style={{ color: MUTED }}>
                      {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"} ·{" "}
                      {formatBackupSize(e.size)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRestoreTarget(e);
                      setRestorePass("");
                      setRestoreErr(null);
                    }}
                    className="rounded-full px-3 py-1.5 text-[12px]"
                    style={{ background: CHARCOAL, color: CREAM_SOFT }}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => void doDelete(e)}
                    disabled={deletingPath === e.name}
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
                    aria-label="Delete backup"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {restoreTarget && (
          <div
            className="mt-4 rounded-xl border p-3"
            style={{ borderColor: BORDER, background: CREAM_SOFT }}
          >
            <div className="mb-2 text-[12.5px]" style={{ color: CHARCOAL }}>
              Restore <span style={{ fontWeight: 600 }}>{restoreTarget.fileName}</span>
            </div>
            <form onSubmit={doRestore} className="flex flex-col gap-2">
              <PasswordField
                value={restorePass}
                onChange={setRestorePass}
                autoComplete="current-password"
                placeholder="Backup passphrase"
                autoFocus
              />
              {restoreErr && <Notice kind="error">{restoreErr}</Notice>}
              <div className="flex gap-2">
                <PrimaryButton type="submit" loading={restoreBusy} disabled={restorePass.length < 1}>
                  Restore into vault
                </PrimaryButton>
                <button
                  type="button"
                  onClick={() => {
                    setRestoreTarget(null);
                    setRestorePass("");
                  }}
                  className="rounded-full px-4 py-2 text-[12px]"
                  style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px]" style={{ color: MUTED, lineHeight: 1.5 }}>
                Duplicate accounts (same issuer, label and secret) are skipped.
              </p>
            </form>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function autoBackupSummary(s: AutoBackupSettings): string {
  if (!s.enabled) return "Off";
  const freq = s.frequency === "weekly" ? "Weekly" : "Daily";
  if (s.lastError) return `${freq} · last attempt failed`;
  if (!s.lastAt) return `${freq} · waiting for first run`;
  return `${freq} · last ${relTime(s.lastAt)}`;
}

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "just now";
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function AutoBackupSheet({
  userId,
  settings,
  onClose,
  onNotice,
}: {
  userId: string;
  settings: AutoBackupSettings;
  onClose: () => void;
  onNotice: (n: NoticeKind) => void;
}) {
  const alreadyStored = hasStoredPassphrase(userId);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [frequency, setFrequency] = useState<AutoBackupFrequency>(settings.frequency);
  const [keep, setKeep] = useState<number>(settings.keep);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [needsPass, setNeedsPass] = useState<boolean>(!alreadyStored);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<AutoBackupLogEntry[]>(() => getAutoBackupLog(userId));

  useEffect(() => {
    setLog(getAutoBackupLog(userId));
    const unsub = subscribeAutoBackup(userId, () => setLog(getAutoBackupLog(userId)));
    return () => unsub();
  }, [userId]);

  const canSave = !enabled
    ? true
    : needsPass
      ? passphrase.length >= 10 && scoreStrength(passphrase) >= 2 && passphrase === confirm
      : true;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!canSave) return;
    setBusy(true);
    try {
      if (!enabled) {
        disableAutoBackup(userId);
        onNotice({ kind: "info", text: "Scheduled auto-backup turned off." });
        onClose();
        return;
      }
      if (needsPass) {
        await enableAutoBackup(userId, passphrase, { frequency, keep });
        onNotice({ kind: "info", text: "Scheduled auto-backup enabled." });
      } else {
        updateAutoBackupSettings(userId, { frequency, keep });
        onNotice({ kind: "info", text: "Auto-backup schedule updated." });
      }
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const backupNow = async () => {
    setErr(null);
    setBusy(true);
    try {
      await runAutoBackupNow(userId);
      const next = getAutoBackupSettings(userId);
      if (next.lastError) throw new Error(next.lastError);
      onNotice({ kind: "info", text: "Backup uploaded." });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label="Close"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto flex max-h-[85vh] w-full max-w-[480px] flex-col overflow-y-auto rounded-t-[22px] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-5 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div
              className="text-[18px]"
              style={{
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: CHARCOAL,
              }}
            >
              Scheduled auto-backup
            </div>
            <div className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
              Uploads an encrypted .avf right after you add or change an account (queued while offline, flushed on reconnect), plus a daily/weekly safety run. Zero-knowledge — passphrase never leaves this device.
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </motion.button>
        </div>

        <form onSubmit={save} className="flex flex-col gap-4">
          <label className="flex items-center justify-between rounded-[14px] px-4 py-3" style={{ background: "rgb(var(--aegis-ink-rgb) / 0.04)", border: `1px solid ${BORDER}` }}>
            <span className="text-[14px]" style={{ color: CHARCOAL, fontWeight: 500 }}>
              Enable auto-backup
            </span>
            <Switch checked={enabled} onCheckedChange={(v) => setEnabled(v)} aria-label="Enable auto-backup" />
          </label>

          {enabled && (
            <>
              <div>
                <div className="mb-1.5 text-[11px] uppercase" style={{ color: MUTED, letterSpacing: "0.14em", fontWeight: 600 }}>
                  Frequency
                </div>
                <div className="flex gap-2">
                  {(["daily", "weekly"] as AutoBackupFrequency[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFrequency(f)}
                      className="flex-1 rounded-[12px] px-3 py-2 text-[13px] capitalize"
                      style={{
                        background: frequency === f ? CHARCOAL : "transparent",
                        color: frequency === f ? CREAM_SOFT : CHARCOAL,
                        border: `1px solid ${BORDER}`,
                        fontWeight: 500,
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] uppercase" style={{ color: MUTED, letterSpacing: "0.14em", fontWeight: 600 }}>
                  Keep last N copies ({keep})
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={keep}
                  onChange={(e) => setKeep(Number(e.target.value))}
                  className="w-full"
                />
                <div className="mt-1 text-[11px]" style={{ color: MUTED }}>
                  Older auto copies are pruned after each successful upload. Manual backups are kept.
                </div>
              </div>

              {needsPass ? (
                <div className="flex flex-col gap-2">
                  <PasswordField
                    value={passphrase}
                    onChange={setPassphrase}
                    placeholder="Auto-backup passphrase (≥ 10 chars)"
                    autoComplete="new-password"
                  />
                  <PasswordField
                    value={confirm}
                    onChange={setConfirm}
                    placeholder="Confirm passphrase"
                    autoComplete="new-password"
                  />
                  <ZxcvbnMeter value={passphrase} />
                  <p className="text-[11px]" style={{ color: MUTED, lineHeight: 1.5 }}>
                    Stored wrapped by your vault key. If you lose it, restoring is impossible — even we can't help.
                  </p>
                </div>
              ) : (
                <div className="rounded-[12px] px-3 py-2 text-[12.5px]" style={{ background: "rgb(var(--aegis-ink-rgb) / 0.04)", border: `1px solid ${BORDER}`, color: MUTED }}>
                  Using the passphrase you saved previously.{" "}
                  <button type="button" onClick={() => setNeedsPass(true)} className="underline" style={{ color: CHARCOAL }}>
                    Change it
                  </button>
                </div>
              )}
            </>
          )}

          <div className="rounded-[12px] px-3 py-2 text-[12px]" style={{ background: "rgb(var(--aegis-ink-rgb) / 0.03)", border: `1px solid ${BORDER}`, color: MUTED }}>
            <div>Status: <span style={{ color: CHARCOAL, fontWeight: 500 }}>{autoBackupSummary(settings)}</span></div>
            {settings.lastError && (
              <div className="mt-1" style={{ color: "#b45309" }}>Last error: {settings.lastError}</div>
            )}
          </div>

          <div className="rounded-[12px] px-3 py-2" style={{ background: "rgb(var(--aegis-ink-rgb) / 0.03)", border: `1px solid ${BORDER}` }}>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-[11px] uppercase" style={{ color: MUTED, letterSpacing: "0.14em", fontWeight: 600 }}>
                Activity
              </div>
              {log.length > 0 && (
                <button
                  type="button"
                  onClick={() => clearAutoBackupLog(userId)}
                  className="text-[11px] underline"
                  style={{ color: MUTED }}
                >
                  Clear
                </button>
              )}
            </div>
            {log.length === 0 ? (
              <div className="text-[12px]" style={{ color: MUTED }}>No auto-backup activity yet.</div>
            ) : (
              <ul className="flex max-h-[180px] flex-col gap-1 overflow-y-auto pr-1">
                {log.map((e, i) => {
                  const dot =
                    e.kind === "success" ? "#16a34a" :
                    e.kind === "error" ? "#dc2626" :
                    e.kind === "start" ? "#2563eb" :
                    e.kind === "skipped" ? "#a3a3a3" :
                    "#d97706";
                  const label =
                    e.kind === "success" ? "Success" :
                    e.kind === "error" ? "Failed" :
                    e.kind === "start" ? "Upload started" :
                    e.kind === "skipped" ? "Skipped" :
                    "Change";
                  return (
                    <li key={`${e.at}-${i}`} className="flex items-start gap-2 text-[12px]" style={{ color: CHARCOAL }}>
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: dot }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span style={{ fontWeight: 500 }}>{label}</span>
                          <span className="text-[10.5px]" style={{ color: MUTED }} title={new Date(e.at).toLocaleString()}>
                            {relTime(e.at)}
                          </span>
                        </div>
                        {e.message && (
                          <div className="truncate text-[11.5px]" style={{ color: MUTED }}>{e.message}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>


          {err && (
            <div className="rounded-[12px] px-3 py-2 text-[12.5px]" style={{ background: "rgba(239,68,68,0.08)", color: "#b91c1c", border: "1px solid rgba(239,68,68,0.25)" }}>
              {err}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <PrimaryButton type="submit" disabled={busy || !canSave}>
              {busy ? "Saving…" : enabled ? "Save schedule" : "Turn off"}
            </PrimaryButton>
            {settings.enabled && !needsPass && (
              <button
                type="button"
                onClick={backupNow}
                disabled={busy}
                className="rounded-full px-4 py-2 text-[13px] disabled:opacity-50"
                style={{ background: "transparent", color: CHARCOAL, border: `1px solid ${BORDER}`, fontWeight: 500 }}
              >
                <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={1.8} />
                Back up now
              </button>
            )}
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

