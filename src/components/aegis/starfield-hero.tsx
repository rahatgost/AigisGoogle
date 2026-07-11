import { useMemo, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Loader2, Shield } from "lucide-react";
import {
  BORDER,
  CHARCOAL,
  CREAM,
  CREAM_SOFT,
  DANGER,
  MUTED,
  soft,
  spring,
} from "@/components/aegis/chrome";

/* -------------------------------------------------------------------------- */
/*  Shared dark-hero + cream-sheet layout for auth / reset / callback flows.  */
/*  Mobile-first, safe-area aware, and identical visual language across all   */
/*  entry screens.                                                            */
/* -------------------------------------------------------------------------- */

interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
  d: number;
}

function useStars(count: number): Star[] {
  return useMemo(() => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    return Array.from({ length: count }, () => ({
      x: rand() * 100,
      y: rand() * 100,
      r: rand() * 1.2 + 0.3,
      o: rand() * 0.5 + 0.25,
      d: rand() * 3 + 2,
    }));
  }, [count]);
}

export function Starfield() {
  const reduce = useReducedMotion();
  const stars = useStars(70);
  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 80% at 78% 12%, rgba(255,255,255,0.10), transparent 55%), radial-gradient(80% 80% at 10% 0%, rgba(255,255,255,0.05), transparent 55%), linear-gradient(180deg, #0d0d1b 0%, #10101f 55%, #16162a 100%)",
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(120% 90% at 70% 10%, black 30%, transparent 80%)",
        }}
      />
      {stars.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.r,
            height: s.r,
            opacity: s.o,
            boxShadow: s.r > 1 ? "0 0 4px rgba(255,255,255,0.6)" : undefined,
          }}
          animate={reduce ? undefined : { opacity: [s.o, s.o * 0.35, s.o] }}
          transition={{ duration: s.d, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

export function BrandRow() {
  return (
    <div className="flex items-center gap-2 text-white">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-[9px]"
        style={{
          background: "linear-gradient(140deg, #4f6bff 0%, #2b3ec9 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(79,107,255,0.55)",
        }}
      >
        <Shield className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Aegis</span>
    </div>
  );
}

/**
 * Full-screen dark-hero + cream-sheet layout.
 * - Mobile-first: safe-area aware, no horizontal scroll, sheet scrolls if needed.
 * - `heroTitle` swaps with a soft crossfade when it changes.
 */
export function StarfieldHeroLayout({
  heroKey,
  heroTitle,
  heroSubtitle,
  heroAccessory,
  children,
  heroMinVh = 34,
}: {
  heroKey?: string;
  heroTitle: ReactNode;
  heroSubtitle?: ReactNode;
  heroAccessory?: ReactNode;
  children: ReactNode;
  heroMinVh?: number;
}) {
  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: "#0d0d1b" }}
    >
      {/* Hero — shrinks aggressively on short viewports (landscape / on-screen keyboard) */}
      <div
        className="relative shrink-0"
        style={{
          minHeight: `clamp(150px, ${heroMinVh}dvh, 320px)`,
          maxHeight: "45dvh",
        }}
      >
        <Starfield />
        <div className="relative z-10 flex h-full flex-col px-5 pt-[max(20px,env(safe-area-inset-top))] pb-5 sm:px-6 sm:pb-6">
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={soft}
          >
            <BrandRow />
          </motion.div>

          <div className="mt-4 flex flex-col gap-2 sm:mt-6 sm:gap-2.5">

            <AnimatePresence mode="wait" initial={false}>
              <motion.h1
                key={(heroKey ?? "") + "-title"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={soft}
                className="text-white"
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontSize: "clamp(30px, 8.5vw, 40px)",
                  lineHeight: 1.05,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                }}
              >
                {heroTitle}
              </motion.h1>
            </AnimatePresence>
            {heroSubtitle && (
              <motion.p
                key={(heroKey ?? "") + "-sub"}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 0.72, y: 0 }}
                transition={{ ...soft, delay: 0.05 }}
                className="max-w-[36ch] text-[14.5px] leading-[1.5] text-white"
              >
                {heroSubtitle}
              </motion.p>
            )}
          </div>
        </div>
      </div>

      {/* Cream sheet */}
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...soft, delay: 0.05 }}
        className="relative -mt-6 flex flex-1 flex-col overflow-y-auto rounded-t-[28px] px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6"
        style={{
          background: CREAM,
          boxShadow: "0 -14px 40px -20px rgba(0,0,0,0.35)",
          color: CHARCOAL,
          WebkitOverflowScrolling: "touch" as never,
        }}
      >
        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col gap-4 sm:gap-5">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shared sheet primitives (used across auth, reset, callback screens)       */
/* -------------------------------------------------------------------------- */

export function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="text-[12.5px] font-medium"
        style={{ color: MUTED, letterSpacing: "-0.005em" }}
      >
        {label}
      </span>
      <div
        className="flex h-[48px] items-center gap-2.5 rounded-[12px] px-3.5"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function BlueButton({
  children,
  type = "button",
  loading,
  disabled,
  onClick,
}: {
  children: ReactNode;
  type?: "button" | "submit";
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      whileTap={disabled || loading ? undefined : { scale: 0.985, opacity: 0.95 }}
      transition={spring}
      className="relative flex h-[50px] w-full items-center justify-center rounded-[12px] text-[15px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60"
      style={{
        background: "linear-gradient(180deg, #4f6bff 0%, #3548d1 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.28), 0 12px 24px -12px rgba(53,72,209,0.55), 0 2px 4px rgba(53,72,209,0.2)",
        letterSpacing: "-0.005em",
        ["--tw-ring-color" as string]: "rgba(53,72,209,0.55)",
        ["--tw-ring-offset-color" as string]: CREAM,
      }}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </motion.button>
  );
}

export function InlineNotice({
  kind,
  children,
}: {
  kind: "error" | "info";
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
      className="rounded-[10px] px-3 py-2 text-[12.5px] leading-snug"
      style={{
        background:
          kind === "error"
            ? "rgb(var(--aegis-danger-rgb) / 0.08)"
            : "rgb(var(--aegis-ink-rgb) / 0.05)",
        color: kind === "error" ? DANGER : CHARCOAL,
        border: `1px solid ${
          kind === "error" ? "rgb(var(--aegis-danger-rgb) / 0.15)" : BORDER
        }`,
      }}
    >
      {children}
    </motion.div>
  );
}
