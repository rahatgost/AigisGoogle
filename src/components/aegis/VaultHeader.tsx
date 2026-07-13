import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { Shield } from "lucide-react";
import { BORDER, CHARCOAL, CREAM_SOFT, MUTED, soft } from "./chrome";

/**
 * Vault page header — refined "Paper & Ink" editorial header.
 *
 * Single-column stack: brand mark + wordmark row (with trailing actions),
 * an oversized Urbanist display title, and a hairline meta row that shows
 * the sync status inline with the account count. Sticky, blurred, and
 * built to feel like a premium native app surface on Android + PWA.
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
  countLabel?: string;
  emptyLabel?: string;
  online?: boolean;
  syncing?: boolean;
  trailing?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const hasCount = typeof count === "number" && count > 0;

  const statusColor = !online
    ? "#c48a2b"
    : syncing
      ? "#3b82f6"
      : "#22a06b";
  const statusLabel = !online
    ? "Offline"
    : syncing
      ? "Syncing"
      : "Live";

  const meta = hasCount
    ? countLabel ?? `${count} accounts`
    : emptyLabel ?? "End-to-end encrypted";

  return (
    <motion.header
      initial={reduce ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
      className="sticky top-0 z-20 -mx-6 flex flex-col px-6 pt-[max(16px,env(safe-area-inset-top))] pb-5"
      style={{
        background:
          "color-mix(in oklab, var(--aegis-cream) 92%, transparent)",
        backdropFilter: "blur(28px) saturate(1.4)",
        WebkitBackdropFilter: "blur(28px) saturate(1.4)",
        borderBottom: `1px solid ${BORDER}`,
        boxShadow:
          "0 10px 24px -20px rgb(var(--aegis-ink-rgb) / 0.22)",
      }}
    >
      {/* Brand row */}
      <div className="flex h-[32px] items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-[26px] w-[26px] items-center justify-center rounded-[9px]"
            style={{
              background: CHARCOAL,
              color: CREAM_SOFT,
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.16), 0 6px 14px -8px rgb(var(--aegis-ink-rgb) / 0.55)",
            }}
          >
            <Shield className="h-[13px] w-[13px]" strokeWidth={2.4} />
          </span>
          <span
            className="font-hero text-[13.5px]"
            style={{
              color: CHARCOAL,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Aegis
          </span>
        </div>
        {trailing && (
          <div className="flex items-center gap-1.5">{trailing}</div>
        )}
      </div>

      {/* Display title */}
      <motion.h1
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...soft, delay: 0.05 }}
        data-testid="page-large-title"
        className="font-hero mt-5 truncate text-[38px] leading-[0.98]"
        style={{
          color: CHARCOAL,
          fontWeight: 800,
          letterSpacing: "-0.045em",
        }}
      >
        {title}
      </motion.h1>

      {/* Hairline meta row */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...soft, delay: 0.09 }}
        className="mt-3 flex items-center gap-2.5 text-[12px]"
        style={{ color: MUTED, fontWeight: 500, letterSpacing: "-0.005em" }}
      >
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="relative flex h-2 w-2 items-center justify-center"
          >
            <motion.span
              className="absolute inset-0 rounded-full"
              style={{ background: statusColor, opacity: 0.22 }}
              animate={
                syncing && !reduce
                  ? { scale: [1, 1.9, 1], opacity: [0.28, 0, 0.28] }
                  : { scale: 1, opacity: 0.22 }
              }
              transition={
                syncing
                  ? { duration: 1.6, repeat: Infinity, ease: "easeOut" }
                  : { duration: 0.2 }
              }
            />
            <span
              className="relative h-[7px] w-[7px] rounded-full"
              style={{
                background: statusColor,
                boxShadow: `0 0 0 2px color-mix(in oklab, ${statusColor} 22%, transparent)`,
              }}
            />
          </span>
          <span
            className="uppercase"
            style={{
              color: CHARCOAL,
              fontWeight: 700,
              letterSpacing: "0.08em",
              fontSize: "10.5px",
            }}
          >
            {statusLabel}
          </span>
        </span>
        <span
          aria-hidden
          className="h-[10px] w-px"
          style={{ background: BORDER }}
        />
        <span className="truncate">{meta}</span>
      </motion.div>
    </motion.header>
  );
}
