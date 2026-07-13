import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { ChevronRight, Shield } from "lucide-react";
import { BORDER, CHARCOAL, CREAM_SOFT, DANGER, MUTED, soft } from "./chrome";

/**
 * Material-3-inspired settings primitives for authenticator screens.
 * Compact top app bar, large title header, grouped rows with hairline
 * dividers — the standard native Android surface language.
 */

export function AppBar({ title, trailing }: { title?: string; trailing?: ReactNode }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
      className="sticky top-0 z-20 -mx-6 flex h-[52px] shrink-0 items-center justify-between px-6"
      style={{
        color: CHARCOAL,
        background: "color-mix(in oklab, var(--aegis-cream) 82%, transparent)",
        backdropFilter: "blur(18px) saturate(1.15)",
        WebkitBackdropFilter: "blur(18px) saturate(1.15)",
        borderBottom: `1px solid rgb(var(--aegis-ink-rgb) / 0.05)`,
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px]"
          style={{
            background: CHARCOAL,
            color: CREAM_SOFT,
            boxShadow:
              "inset 0 1px 0 rgb(255 255 255 / 0.16), 0 6px 14px -8px rgb(var(--aegis-ink-rgb) / 0.6)",
          }}
        >
          <Shield className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span
          data-testid="page-app-bar-title"
          className="truncate text-[14px]"
          style={{
            fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
            fontWeight: 600,
            letterSpacing: "-0.012em",
          }}
        >
          {title ?? "Aegis"}
        </span>
      </div>
      <div className="flex items-center gap-1.5">{trailing}</div>
    </motion.header>
  );
}

export function AppBarButton({
  onClick,
  label,
  children,
}: {
  onClick?: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      aria-label={label}
      data-testid={`app-bar-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-button`}
      className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
      style={{
        color: CHARCOAL,
        background: "rgb(var(--aegis-ink-rgb) / 0.045)",
        border: `1px solid ${BORDER}`,
      }}
    >
      {children}
    </motion.button>
  );
}

export function LargeTitle({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
      className="sticky top-0 z-10 -mx-6 flex flex-col px-6 pt-[max(20px,env(safe-area-inset-top))] pb-4"
      style={{
        background:
          "linear-gradient(to bottom, color-mix(in oklab, var(--aegis-cream) 96%, transparent) 0%, color-mix(in oklab, var(--aegis-cream) 88%, transparent) 78%, color-mix(in oklab, var(--aegis-cream) 0%, transparent) 100%)",
        backdropFilter: "blur(22px) saturate(1.1)",
        WebkitBackdropFilter: "blur(22px) saturate(1.1)",
      }}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <motion.h1
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...soft, delay: 0.04 }}
            data-testid="page-large-title"
            className="truncate text-[32px] leading-[1.05]"
            style={{
              color: CHARCOAL,
              fontWeight: 650,
              letterSpacing: "-0.038em",
            }}
          >
            {title}
          </motion.h1>
          {subtitle && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...soft, delay: 0.09 }}
              className="mt-1.5 text-[13.5px] leading-[1.4]"
              style={{ color: MUTED, letterSpacing: "-0.005em", maxWidth: "34ch" }}
            >
              {subtitle}
            </motion.p>
          )}
        </div>
        {trailing && (
          <div className="mb-1 flex shrink-0 items-center gap-1.5">{trailing}</div>
        )}
      </div>
    </motion.header>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="scroll-fade-in px-1 pt-4 pb-1.5 text-[11px] uppercase"
      style={{ color: MUTED, letterSpacing: "0.14em", fontWeight: 600 }}
    >
      {children}
    </div>
  );
}

export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <div
      className="scroll-fade-in shrink-0 overflow-hidden rounded-[16px]"
      style={{
        background: CREAM_SOFT,
        border: `1px solid ${BORDER}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
      }}
    >
      <div className="divide-y" style={{ borderColor: BORDER }}>
        {children}
      </div>
    </div>
  );
}

interface RowProps {
  icon?: ReactNode;
  title: string;
  value?: ReactNode;
  description?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
  chevron?: boolean;
  disabled?: boolean;
  danger?: boolean;
  badge?: string;
}

export function SettingsRow({
  icon,
  title,
  value,
  description,
  onClick,
  trailing,
  chevron,
  disabled,
  danger,
  badge,
}: RowProps) {
  const Tag = onClick ? motion.button : motion.div;
  const clickable = !!onClick && !disabled;
  const color = danger ? DANGER : CHARCOAL;

  return (
    <Tag
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      whileTap={clickable ? { backgroundColor: "rgb(var(--aegis-ink-rgb) / 0.04)" } : undefined}
      className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-55"
      style={{ borderColor: BORDER }}
    >
      {icon && (
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: "rgb(var(--aegis-ink-rgb) / 0.05)",
            color,
            border: `1px solid ${BORDER}`,
          }}
        >
          {icon}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-[14.5px]"
            style={{ color, fontWeight: 500, letterSpacing: "-0.005em" }}
          >
            {title}
          </span>
          {badge && (
            <span
              className="rounded-full px-1.5 py-[1px] text-[9px] uppercase"
              style={{
                background: "rgb(var(--aegis-ink-rgb) / 0.06)",
                color: MUTED,
                border: `1px solid ${BORDER}`,
                letterSpacing: "0.14em",
                fontWeight: 600,
              }}
            >
              {badge}
            </span>
          )}
        </div>
        {(description || value) && (
          <div className="mt-0.5 truncate text-[12.5px] leading-[1.4]" style={{ color: MUTED }}>
            {value ?? description}
          </div>
        )}
      </div>
      {trailing}
      {chevron && !trailing && (
        <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={1.8} style={{ color: MUTED }} />
      )}
    </Tag>
  );
}
