// Phase 7.3 — reusable "encrypted export" sheet. Used by the vault's bulk
// export flow to build an `.avf` file for a subset of accounts. Mirrors
// the styling of the full-vault export sheet in `security.tsx` but takes
// the accounts list as a prop so callers control the subset.

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useLingui } from "@lingui/react";
import {
  BORDER,
  CHARCOAL,
  CREAM_SOFT,
  MUTED,
  Notice,
  PrimaryButton,
  soft,
} from "@/components/aegis/chrome";
import { typeSheetTitleLg, typeSubLabel } from "@/components/aegis/typography";
import { PasswordField, StrengthMeter, scoreStrength } from "@/components/aegis/password-field";
import { buildEncryptedExport, downloadExport } from "@/lib/vault-export";
import type { DecryptedAccount } from "@/lib/vault-accounts";

export function ExportPassphraseSheet({
  accounts,
  onClose,
  onDone,
  title,
  subtitle,
}: {
  accounts: DecryptedAccount[];
  onClose: () => void;
  onDone: (count: number) => void;
  title?: string;
  subtitle?: string;
}) {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string, values?: Record<string, unknown>) => {
    const msg = values ? i18n._(id, values) : i18n._(id);
    return msg === id ? fallback : msg;
  };
  const resolvedTitle = title ?? t("export.title", "Encrypted export");
  const resolvedSubtitle =
    subtitle ?? t("export.subtitle", "Pick a passphrase for this backup file. You'll need it to restore.");

  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit =
    passphrase.length >= 10 && scoreStrength(passphrase) >= 2 && passphrase === confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!canSubmit) return;
    if (accounts.length === 0) {
      setErr(t("export.error.nothing", "Nothing selected to export."));
      return;
    }
    setBusy(true);
    try {
      const file = await buildEncryptedExport(accounts, passphrase);
      downloadExport(file);
      onDone(accounts.length);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t("export.error.build", "Could not build export."));
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
        aria-label={t("common.close", "Close")}
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
            <div style={typeSheetTitleLg}>{resolvedTitle}</div>
            <div className="mt-1" style={{ ...typeSubLabel, fontSize: 12.5 }}>
              {accounts.length === 1
                ? t("export.count.one", "{count} account selected. {subtitle}", { count: accounts.length, subtitle: resolvedSubtitle })
                : t("export.count.other", "{count} accounts selected. {subtitle}", { count: accounts.length, subtitle: resolvedSubtitle })}
            </div>
          </div>

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label={t("common.close", "Close")}
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
            placeholder={t("export.passphrase.placeholder", "Export passphrase")}
            autoFocus
          />
          <StrengthMeter value={passphrase} />
          <PasswordField
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            minLength={10}
            placeholder={t("export.confirm.placeholder", "Confirm passphrase")}
            delay={0.05}
          />

          {err && <Notice kind="error">{err}</Notice>}

          <div className="pt-1">
            <PrimaryButton type="submit" loading={busy} disabled={!canSubmit}>
              {t("export.download", "Download .avf backup")}
            </PrimaryButton>
          </div>

          <p className="pt-1 text-[11.5px]" style={{ color: MUTED, lineHeight: 1.5 }}>
            {t("export.footnote", "The file is encrypted end-to-end with AES-256-GCM. Lose the passphrase and the backup is unrecoverable.")}
          </p>
        </form>
      </motion.div>
    </motion.div>
  );
}
