import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
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
} from "lucide-react";

import { DevicesSection } from "@/components/aegis/devices-section";

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
import { PasswordField, StrengthMeter, scoreStrength } from "@/components/aegis/password-field";
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
  KDF_ALGORITHM,
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
import { listAccounts } from "@/lib/vault-accounts";
import { buildEncryptedExport, downloadExport } from "@/lib/vault-export";

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
      { property: "og:url", content: "https://hug-machine-maker.lovable.app/security" },
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
  const hideCodes = useHideCodes();
  const [hint, setHint] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoLockOpen, setAutoLockOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState<boolean>(() => isBiometricEnabled(user.id));
  const [bioBusy, setBioBusy] = useState(false);

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
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
            style={{ background: CHARCOAL, color: CREAM_SOFT }}
          >
            <ShieldCheck className="h-6 w-6" strokeWidth={1.7} />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[15px]"
              style={{ color: CHARCOAL, fontWeight: 600, letterSpacing: "-0.01em" }}
            >
              Vault unlocked
            </div>
            <div className="truncate text-[12.5px]" style={{ color: MUTED }}>
              End-to-end encrypted on this device
            </div>
          </div>
        </motion.div>

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
        </SettingsGroup>

        <SectionLabel>{t("security.section.devices", "Devices")}</SectionLabel>
        <DevicesSection heading={t("security.devices", "Devices")} />

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

  const canSubmit =
    current.length > 0 &&
    next.length >= 10 &&
    scoreStrength(next) >= 2 &&
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
      if (data.kdf_algorithm !== KDF_ALGORITHM) {
        throw new Error("Vault was created with a different key algorithm.");
      }
      // Verify current passphrase actually unwraps the DEK.
      try {
        await unwrapVaultKey(
          current,
          toBytes(data.kdf_salt),
          toBytes(data.recovery_wrapped_key),
          toBytes(data.recovery_wrapped_key_iv),
        );
      } catch {
        throw new Error("Current passphrase is incorrect.");
      }
      // Rotate: same DEK, new KEK + salt + iv.
      const { salt, wrappedKey, wrappedKeyIv, kdfAlgorithm } = await rewrapVaultKey(
        current,
        next,
        toBytes(data.kdf_salt),
        toBytes(data.recovery_wrapped_key),
        toBytes(data.recovery_wrapped_key_iv),
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
      const freshDek = await unwrapVaultKey(next, salt, wrappedKey, wrappedKeyIv);
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
                fontFamily: "'Playfair Display', serif",
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
          <StrengthMeter value={next} />
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
                fontFamily: "'Playfair Display', serif",
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
                fontFamily: "'Playfair Display', serif",
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
