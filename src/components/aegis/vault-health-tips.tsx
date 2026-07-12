import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy as CopyIcon,
  Image as ImageIcon,
  RotateCcw,
  Sparkles,
  Star,
} from "lucide-react";
import { useLingui } from "@lingui/react";

import { BORDER, CHARCOAL, CREAM, DANGER, MUTED, soft } from "@/components/aegis/chrome";
import { SectionLabel } from "@/components/aegis/settings";
import { supabase } from "@/integrations/supabase/client";
import { getVaultKey, useVaultUnlocked } from "@/lib/vault-session";
import { listAccounts } from "@/lib/vault-accounts";
import { computeVaultHealth, type VaultHealthReport } from "@/lib/vault-health";
import { HealthSheet } from "@/components/aegis/vault-health-section";
import { clearNeedsRotation } from "@/lib/vault-sharing";

/**
 * Vault health tips — inline actionable list that sits directly under the
 * Vault Health hero on the Security tab. Surfaces the top 3 findings
 * across three categories (needs rotation, weak favourites, missing icons)
 * with per-row CTAs so the common fixes are one tap away, without opening
 * the full HealthSheet.
 */

type Tip =
  | {
      kind: "rotate";
      id: string;
      accountId: string;
      issuer: string;
      label: string;
    }
  | {
      kind: "weak_favorite";
      id: string;
      accountId: string;
      issuer: string;
      label: string;
    }
  | {
      kind: "missing_icon";
      id: string;
      accountId: string;
      issuer: string;
      label: string;
    };

interface RotationRow {
  id: string;
  issuer: string;
  label: string;
}

const MAX_INLINE = 3;

export function VaultHealthTips() {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string, values?: Record<string, unknown>) => {
    const msg = values ? i18n._(id, values) : i18n._(id);
    return msg === id ? fallback : msg;
  };
  const unlocked = useVaultUnlocked();
  const navigate = useNavigate();

  const [report, setReport] = useState<VaultHealthReport | null>(null);
  const [rotationRows, setRotationRows] = useState<RotationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const dek = getVaultKey();
    if (!dek) return;
    setLoading(true);
    try {
      const [accounts, rotRes] = await Promise.all([
        listAccounts(dek),
        supabase
          .from("vault_accounts")
          .select("id, issuer, label, needs_rotation")
          .eq("needs_rotation", true),
      ]);
      const next = await computeVaultHealth(accounts);
      setReport(next);
      setRotationRows(((rotRes.data ?? []) as Array<RotationRow & { needs_rotation: boolean }>).map(
        (r) => ({ id: r.id, issuer: r.issuer, label: r.label }),
      ));
    } catch {
      // Non-fatal — the hero surfaces the top-level error state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    void load();
  }, [unlocked, load]);

  const tips: Tip[] = [];
  for (const r of rotationRows) {
    tips.push({ kind: "rotate", id: `rot:${r.id}`, accountId: r.id, issuer: r.issuer, label: r.label });
  }
  if (report) {
    for (const w of report.weakFavorites) {
      tips.push({
        kind: "weak_favorite",
        id: `wf:${w.accountId}`,
        accountId: w.accountId,
        issuer: w.issuer,
        label: w.label,
      });
    }
    for (const m of report.missingIcons) {
      tips.push({
        kind: "missing_icon",
        id: `mi:${m.accountId}`,
        accountId: m.accountId,
        issuer: m.issuer,
        label: m.label,
      });
    }
  }

  const visible = tips.slice(0, MAX_INLINE);
  const overflow = Math.max(0, tips.length - visible.length);

  if (!unlocked) return null;
  if (loading && tips.length === 0) return null;
  if (tips.length === 0) return null;

  const handleMarkRotated = async (accountId: string) => {
    setBusyIds((s) => new Set(s).add(accountId));
    try {
      await clearNeedsRotation(accountId);
      setRotationRows((rows) => rows.filter((r) => r.id !== accountId));
      toast.success(t("vaultHealth.tips.rotatedToast", "Marked as rotated"));
    } catch (err) {
      toast.error(
        t("vaultHealth.tips.rotatedError", "Could not update"),
        { description: err instanceof Error ? err.message : undefined },
      );
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(accountId);
        return n;
      });
    }
  };

  const handleCopyIssuer = async (issuer: string) => {
    try {
      await navigator.clipboard.writeText(issuer);
      toast.success(t("vaultHealth.tips.copied", "Copied"));
    } catch {
      /* clipboard denied — silent */
    }
  };

  return (
    <>
      <SectionLabel>
        {t("vaultHealth.tips.section", "Recommended actions")}
      </SectionLabel>
      <div
        className="flex flex-col overflow-hidden rounded-[14px]"
        style={{ background: CREAM, border: `1px solid ${BORDER}` }}
      >
        {visible.map((tip, idx) => (
          <TipRow
            key={tip.id}
            tip={tip}
            isLast={idx === visible.length - 1 && overflow === 0}
            busy={busyIds.has(tip.accountId)}
            t={t}
            onMarkRotated={() => void handleMarkRotated(tip.accountId)}
            onCopyIssuer={() => void handleCopyIssuer(tip.issuer)}
            onOpenAccount={() => navigate({ to: "/vault" })}
          />
        ))}
        {overflow > 0 && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--aegis-cream)_92%,var(--aegis-ink))]"
            style={{ borderTop: `1px solid ${BORDER}` }}
          >
            <span className="text-[13.5px]" style={{ color: CHARCOAL, fontWeight: 500 }}>
              {t("vaultHealth.tips.seeAll", "See all {count} findings", { count: tips.length })}
            </span>
            <ChevronRight className="h-4 w-4" strokeWidth={1.8} style={{ color: MUTED }} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {sheetOpen && (
          <HealthSheet
            report={report}
            loading={false}
            errorMsg={null}
            unlocked={unlocked}
            onRescan={() => void load()}
            onClose={() => setSheetOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function TipRow({
  tip,
  isLast,
  busy,
  t,
  onMarkRotated,
  onCopyIssuer,
  onOpenAccount,
}: {
  tip: Tip;
  isLast: boolean;
  busy: boolean;
  t: (id: string, fallback: string, values?: Record<string, unknown>) => string;
  onMarkRotated: () => void;
  onCopyIssuer: () => void;
  onOpenAccount: () => void;
}) {
  const meta = describe(tip, t);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
      className="flex items-start gap-3 px-4 py-3"
      style={{ borderBottom: isLast ? "none" : `1px solid ${BORDER}` }}
    >
      <div
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{
          background: `rgb(var(${meta.tokenBg}) / ${meta.bgOpacity})`,
          color: meta.iconColor,
        }}
        aria-hidden
      >
        {meta.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="text-[13.5px] leading-[1.35]"
          style={{ color: CHARCOAL, fontWeight: 600 }}
        >
          {meta.title}
        </div>
        <div
          className="mt-0.5 truncate text-[12.5px]"
          style={{ color: MUTED, lineHeight: 1.4 }}
        >
          {tip.issuer}
          {tip.label ? ` · ${tip.label}` : ""}
        </div>
        <div className="mt-1.5 text-[12px]" style={{ color: MUTED, lineHeight: 1.4 }}>
          {meta.description}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {tip.kind === "rotate" && (
            <ActionButton onClick={onMarkRotated} disabled={busy} primary>
              <Check className="h-3 w-3" strokeWidth={2} />
              {busy
                ? t("vaultHealth.tips.working", "Working…")
                : t("vaultHealth.tips.markRotated", "Mark rotated")}
            </ActionButton>
          )}
          {tip.kind !== "rotate" && (
            <ActionButton onClick={onOpenAccount}>
              <Sparkles className="h-3 w-3" strokeWidth={2} />
              {t("vaultHealth.tips.openVault", "Open in vault")}
            </ActionButton>
          )}
          <ActionButton onClick={onCopyIssuer}>
            <CopyIcon className="h-3 w-3" strokeWidth={2} />
            {t("vaultHealth.tips.copyIssuer", "Copy issuer")}
          </ActionButton>
        </div>
      </div>
    </motion.div>
  );
}

function ActionButton({
  onClick,
  disabled,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] disabled:opacity-60"
      style={{
        background: primary ? CHARCOAL : "transparent",
        color: primary ? CREAM : CHARCOAL,
        border: primary ? "none" : `1px solid ${BORDER}`,
        fontWeight: 500,
        letterSpacing: "-0.005em",
      }}
    >
      {children}
    </motion.button>
  );
}

function describe(
  tip: Tip,
  t: (id: string, fallback: string, values?: Record<string, unknown>) => string,
): {
  title: string;
  description: string;
  icon: React.ReactNode;
  tokenBg: "--aegis-danger-rgb" | "--aegis-ink-rgb";
  bgOpacity: number;
  iconColor: string;
} {
  switch (tip.kind) {
    case "rotate":
      return {
        title: t("vaultHealth.tips.rotate.title", "Rotate this secret"),
        description: t(
          "vaultHealth.tips.rotate.desc",
          "You revoked a share for this account. Re-enroll at the source site, then mark it rotated.",
        ),
        icon: <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />,
        tokenBg: "--aegis-danger-rgb",
        bgOpacity: 0.12,
        iconColor: DANGER,
      };
    case "weak_favorite":
      return {
        title: t("vaultHealth.tips.weakFav.title", "Rename this favourite"),
        description: t(
          "vaultHealth.tips.weakFav.desc",
          "Favourite issuers should be unambiguous — this one may not match a real domain.",
        ),
        icon: <Star className="h-3.5 w-3.5" strokeWidth={1.8} />,
        tokenBg: "--aegis-ink-rgb",
        bgOpacity: 0.08,
        iconColor: CHARCOAL,
      };
    case "missing_icon":
      return {
        title: t("vaultHealth.tips.icon.title", "Add a recognisable name"),
        description: t(
          "vaultHealth.tips.icon.desc",
          "We couldn't match this issuer to a logo. Rename it to the real service name for quick scanning.",
        ),
        icon: <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} />,
        tokenBg: "--aegis-ink-rgb",
        bgOpacity: 0.06,
        iconColor: MUTED,
      };
    default: {
      // Exhaustiveness guard — TS should never let us reach this branch.
      const _never: never = tip;
      void _never;
      return {
        title: "",
        description: "",
        icon: <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.8} />,
        tokenBg: "--aegis-ink-rgb",
        bgOpacity: 0.06,
        iconColor: MUTED,
      };
    }
  }
}
