import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { KeyRound, ShieldCheck, Plus, User, type LucideIcon } from "lucide-react";
import { BORDER, CHARCOAL, CREAM_SOFT, INSET_SHADOW, MUTED, soft } from "./chrome";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  emphasized?: boolean;
}

const TABS: Tab[] = [
  { id: "vault", label: "Vault", icon: KeyRound, to: "/vault" },
  { id: "security", label: "Security", icon: ShieldCheck, to: "/security" },
  { id: "add", label: "Add", icon: Plus, to: "/vault/new", emphasized: true },
  { id: "profile", label: "Profile", icon: User, to: "/profile" },
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

  return (
    <motion.nav
      initial={{ opacity: 0, y: 20 }}
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
            "0 -1px 0 rgba(255,255,255,0.6) inset, 0 16px 40px -18px rgba(28,28,28,0.28), 0 4px 14px -8px rgba(28,28,28,0.18)",
          backdropFilter: "blur(8px)",
        }}
      >
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.to);
          const Icon = tab.icon;

          if (tab.emphasized) {
            return (
              <Link
                key={tab.id}
                to={tab.to}
                aria-label={tab.label}
                className="group relative flex flex-1 flex-col items-center justify-end gap-1 rounded-[14px] pt-1"
              >
                <motion.span
                  whileTap={{ scale: 0.92 }}
                  className="flex h-11 w-11 items-center justify-center rounded-[14px]"
                  style={{
                    background: CHARCOAL,
                    color: CREAM_SOFT,
                    boxShadow: `${INSET_SHADOW}, 0 8px 20px -8px rgba(28,28,28,0.55)`,
                  }}
                >
                  <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} />
                </motion.span>
                <span
                  className="text-[10.5px]"
                  style={{
                    color: active ? CHARCOAL : MUTED,
                    fontWeight: active ? 600 : 500,
                    letterSpacing: "0.01em",
                  }}
                >
                  {tab.label}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={tab.id}
              to={tab.to}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[14px] py-1.5"
            >
              {active && (
                <motion.span
                  layoutId="tab-active-pill"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="absolute inset-0 rounded-[14px]"
                  style={{
                    background: "rgba(28,28,28,0.06)",
                    border: `1px solid ${BORDER}`,
                  }}
                />
              )}
              <motion.span
                whileTap={{ scale: 0.9 }}
                className="relative flex h-6 items-center justify-center"
                style={{ color: active ? CHARCOAL : MUTED }}
              >
                <Icon
                  className="h-[18px] w-[18px]"
                  strokeWidth={active ? 2 : 1.7}
                />
              </motion.span>
              <span
                className="relative text-[10.5px]"
                style={{
                  color: active ? CHARCOAL : MUTED,
                  fontWeight: active ? 600 : 500,
                  letterSpacing: "0.01em",
                }}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </motion.nav>
  );
}
