import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Shield } from "lucide-react";
import { BORDER, CHARCOAL, CREAM_SOFT, MUTED, soft } from "./chrome";

/**
 * Vault page header — Android-native "expressive" surface inspired by the
 * Material 3 Expressive language used in Google Wallet / the new Google
 * Authenticator: a floating glass strip with a brand chip and trailing
 * actions, a large weighted title, and a live sync-status pill sitting
 * inline with the counter.
 *
 * Kept API-close to LargeTitle so the vault page can swap it in without
 * restructuring surrounding notices.
 */
export function VaultHeader({
  title,
  count,
  countLabel,
  emptyLabel,
  online = true,
  syncing = false,
  trailing,
}: {
  title: string;
  count?: number;
  /** Label used when count > 0, e.g. "3 accounts synced". Should already be pluralised. */
  countLabel?: string;
  /** Fallback subtitle when count === 0 / undefined. */
  emptyLabel?: string;
  online?: boolean;
  syncing?: boolean;
  trailing?: ReactNode;
}) {
  const hasCount = typeof count === "number" && count > 0;

  const statusColor = !online
    ? "#c48a2b"
    : syncing
      ? "#3b82f6"
      : "#22a06b";
  const statusRing = !online
    ? "rgba(196,138,43,0.18)"
    : syncing
      ? "rgba(59,130,246,0.18)"
      : "rgba(34,160,107,0.18)";

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
      className="sticky top-0 z-20 -mx-6 flex flex-col px-6 pt-[max(14px,env(safe-area-inset-top))] pb-4"
      style={{
        background:
          "color-mix(in oklab, var(--aegis-cream) 88%, transparent)",
        backdropFilter: "blur(24px) saturate(1.35)",
        WebkitBackdropFilter: "blur(24px) saturate(1.35)",
        borderBottom: `1px solid ${BORDER}`,
        boxShadow:
          "0 8px 18px -14px rgb(var(--aegis-ink-rgb) / 0.18)",
      }}
    >
      {/* Top strip: brand chip · trailing actions */}
      <div className="flex h-[36px] items-center justify-between">
        <motion.div
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...soft, delay: 0.02 }}
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3"
          style={{
            background: CREAM_SOFT,
            border: `1px solid ${BORDER}`,
            boxShadow:
              "0 1px 2px rgb(var(--aegis-ink-rgb) / 0.04), inset 0 1px 0 rgba(255,255,255,0.55)",
          }}
        >
          <span
            aria-hidden
            className="flex h-[22px] w-[22px] items-center justify-center rounded-full"
            style={{
              background: CHARCOAL,
              color: CREAM_SOFT,
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 10px -6px rgb(var(--aegis-ink-rgb) / 0.6)",
            }}
          >
            <Shield className="h-3 w-3" strokeWidth={2.2} />
          </span>
          <span
            className="text-[11.5px]"
            style={{
              color: CHARCOAL,
              fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Vault
          </span>
        </motion.div>
        {trailing && <div className="flex items-center gap-1.5">{trailing}</div>}
      </div>

      {/* Large title */}
      <motion.h1
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...soft, delay: 0.06 }}
        data-testid="page-large-title"
        className="mt-4 truncate text-[34px] leading-[1.02]"
        style={{
          color: CHARCOAL,
          fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
          fontWeight: 680,
          letterSpacing: "-0.04em",
        }}
      >
        {title}
      </motion.h1>

      {/* Status row */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...soft, delay: 0.11 }}
        className="mt-2.5 flex items-center gap-2"
      >
        <span
          className="flex items-center gap-1.5 rounded-full py-[5px] pl-[7px] pr-2.5 text-[11.5px]"
          style={{
            background: CREAM_SOFT,
            border: `1px solid ${BORDER}`,
            color: CHARCOAL,
            fontWeight: 600,
            letterSpacing: "-0.003em",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
          }}
        >
          <span
            aria-hidden
            className="relative flex h-2 w-2 items-center justify-center"
          >
            <span
              className="absolute inset-0 rounded-full"
              style={{ background: statusRing }}
            />
            <motion.span
              className="relative h-[7px] w-[7px] rounded-full"
              style={{ background: statusColor }}
              animate={
                syncing
                  ? { scale: [1, 1.25, 1], opacity: [1, 0.7, 1] }
                  : { scale: 1, opacity: 1 }
              }
              transition={
                syncing
                  ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.2 }
              }
            />
          </span>
          {hasCount
            ? countLabel ?? `${count} synced`
            : emptyLabel ?? "End-to-end encrypted"}
        </span>
      </motion.div>
    </motion.header>
  );
}
