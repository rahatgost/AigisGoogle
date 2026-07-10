import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { KeyRound, ShieldCheck, Plus, User, Lock, type LucideIcon } from "lucide-react";
import { useLingui } from "@lingui/react";
import { toast } from "sonner";
import { BORDER, CHARCOAL, CREAM_SOFT, INSET_SHADOW, MUTED, soft } from "./chrome";
import { useVaultReadOnly } from "@/lib/vault-session";

interface Tab {
  id: string;
  labelId: string;
  labelFallback: string;
  icon: LucideIcon;
  to: string;
  emphasized?: boolean;
}

const TABS: Tab[] = [
  { id: "vault", labelId: "tabs.vault", labelFallback: "Vault", icon: KeyRound, to: "/vault" },
  { id: "security", labelId: "tabs.security", labelFallback: "Security", icon: ShieldCheck, to: "/security" },
  { id: "add", labelId: "tabs.add", labelFallback: "Add", icon: Plus, to: "/vault/new", emphasized: true },
  { id: "profile", labelId: "tabs.profile", labelFallback: "Profile", icon: User, to: "/profile" },
];

function isActive(pathname: string, to: string) {
  if (to === "/vault") return pathname === "/vault";
  return pathname === to || pathname.startsWith(to + "/");
}

/**
 * Fixed bottom navigation bar. Renders inside AegisScreen — position it so it
 * stays glued to the bottom of the centered mobile shell.
 * Pair with `pb-28` (or similar) on the scrollable content region.
 */
export function BottomTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { i18n } = useLingui();
  const readOnly = useVaultReadOnly();
  const t = (id: string, fallback: string) => {
    const msg = i18n._(id);
    return msg === id ? fallback : msg;
  };

  return (
    <motion.nav
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...soft, delay: 0.08 }}
      aria-label="Primary"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[max(14px,env(safe-area-inset-bottom))]"
    >
      <div
        className="pointer-events-auto mx-auto flex w-full max-w-[420px] items-stretch justify-between gap-1 rounded-[20px] px-2 py-2"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow:
            "0 -1px 0 rgba(255,255,255,0.6) inset, 0 16px 40px -18px rgb(var(--aegis-ink-rgb) / 0.28), 0 4px 14px -8px rgb(var(--aegis-ink-rgb) / 0.18)",
          backdropFilter: "blur(8px)",
        }}
      >
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.to);
          const Icon = tab.icon;
          const label = t(tab.labelId, tab.labelFallback);

          if (tab.emphasized) {
            const disabled = readOnly && tab.id === "add";
            return (
              <Link
                key={tab.id}
                to={tab.to}
                aria-label={label}
                aria-disabled={disabled || undefined}
                onClick={(e) => {
                  if (disabled) {
                    e.preventDefault();
                    toast.error(
                      t("vault.readOnly.blocked", "Read-only recovery vault — writes are disabled."),
                    );
                  }
                }}
                className="relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[14px] py-1.5"
                style={disabled ? { opacity: 0.5 } : undefined}
              >
                <motion.span
                  whileTap={disabled ? undefined : { scale: 0.92 }}
                  className="flex h-8 w-8 items-center justify-center rounded-[12px]"
                  style={{
                    background: CHARCOAL,
                    color: CREAM_SOFT,
                    boxShadow: `${INSET_SHADOW}, 0 6px 16px -8px rgb(var(--aegis-ink-rgb) / 0.55)`,
                  }}
                >
                  {disabled ? (
                    <Lock className="h-[14px] w-[14px]" strokeWidth={2.2} />
                  ) : (
                    <Plus className="h-[16px] w-[16px]" strokeWidth={2.2} />
                  )}
                </motion.span>
                <span
                  className="text-[10.5px]"
                  style={{
                    color: active ? CHARCOAL : MUTED,
                    fontWeight: active ? 600 : 500,
                    letterSpacing: "0.01em",
                  }}
                >
                  {label}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={tab.id}
              to={tab.to}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[14px] py-1.5"
            >
              {active && (
                <motion.span
                  layoutId="tab-active-pill"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="absolute inset-0 rounded-[14px]"
                  style={{
                    background: "rgb(var(--aegis-ink-rgb) / 0.06)",
                    border: `1px solid ${BORDER}`,
                  }}
                />
              )}
              <motion.span
                whileTap={{ scale: 0.9 }}
                className="relative flex h-6 items-center justify-center"
                style={{ color: active ? CHARCOAL : MUTED }}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.7} />
              </motion.span>
              <span
                className="relative text-[10.5px]"
                style={{
                  color: active ? CHARCOAL : MUTED,
                  fontWeight: active ? 600 : 500,
                  letterSpacing: "0.01em",
                }}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </motion.nav>
  );
}
