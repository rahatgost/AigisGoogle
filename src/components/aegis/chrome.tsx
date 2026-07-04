import { motion, useReducedMotion, type MotionProps } from "framer-motion";
import { Shield, ArrowRight, Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/*  Aegis warm-cream design system (shared with the onboarding flow)          */
/* -------------------------------------------------------------------------- */

export const CREAM = "#f7f4ed";
export const CREAM_SOFT = "#fcfbf8";
export const CHARCOAL = "#1c1c1c";
export const BORDER = "#eceae4";
export const MUTED = "#5f5f5d";
export const DANGER = "#8a2020";

export const INSET_SHADOW =
  "rgba(255,255,255,0.2) 0 0.5px 0 0 inset, rgba(0,0,0,0.2) 0 0 0 0.5px inset, rgba(0,0,0,0.05) 0 1px 2px 0";

export const spring = { type: "spring" as const, stiffness: 260, damping: 30, mass: 0.9 };
export const soft = { type: "spring" as const, stiffness: 200, damping: 32, mass: 1 };

/* ---------------- backdrop ---------------- */

export function Backdrop() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ background: CREAM }}>
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 20% 0%, rgba(255,214,180,0.35), transparent 55%), radial-gradient(90% 70% at 90% 15%, rgba(255,196,206,0.28), transparent 60%), radial-gradient(100% 80% at 50% 100%, rgba(180,196,230,0.32), transparent 60%)",
        }}
      />
      <motion.div
        className="absolute -left-24 top-[6%] h-[320px] w-[320px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(230,180,140,0.35), transparent 70%)", filter: "blur(60px)" }}
        animate={reduce ? undefined : { x: [0, 16, 0], y: [0, -10, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-24 bottom-[8%] h-[380px] w-[380px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(200,170,210,0.28), transparent 70%)", filter: "blur(70px)" }}
        animate={reduce ? undefined : { x: [0, -14, 0], y: [0, 10, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        className="absolute inset-0 opacity-[0.5] mix-blend-multiply"
        style={{
          backgroundImage: "radial-gradient(rgba(28,28,28,0.05) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
    </div>
  );
}

/* ---------------- shell ---------------- */

export function AegisScreen({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ color: CHARCOAL }}>
      <Backdrop />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[440px] flex-col px-6 pt-[max(20px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  );
}

export function BrandBar({ right }: { right?: ReactNode }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
      className="flex h-12 shrink-0 items-center justify-between"
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{ background: CHARCOAL, color: CREAM_SOFT, boxShadow: INSET_SHADOW }}
        >
          <Shield className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
        <span className="text-[13px] font-medium tracking-tight">Aegis</span>
      </div>
      {right}
    </motion.header>
  );
}

/* ---------------- typography ---------------- */

export function Display({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.h1
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...soft, delay }}
      className="text-[34px] leading-[1.02]"
      style={{ color: CHARCOAL, fontWeight: 600, letterSpacing: "-0.03em", fontFamily: "'Instrument Serif', serif" }}
    >
      {children}
    </motion.h1>
  );
}

export function Lede({ children, delay = 0.05 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...soft, delay }}
      className="text-[15px] leading-[1.5]"
      style={{ color: MUTED, maxWidth: "34ch" }}
    >
      {children}
    </motion.p>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={soft} className="flex">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] uppercase"
        style={{ color: CHARCOAL, background: CREAM_SOFT, border: `1px solid ${BORDER}`, letterSpacing: "0.12em", fontWeight: 500 }}
      >
        {children}
      </span>
    </motion.div>
  );
}

/* ---------------- surfaces ---------------- */

export function IconChip({ children, size = 40 }: { children: ReactNode; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full"
      style={{ width: size, height: size, background: CREAM_SOFT, border: `1px solid ${BORDER}`, color: CHARCOAL }}
    >
      {children}
    </span>
  );
}

export function HeroIcon({ Icon }: { Icon: LucideIcon }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex items-center justify-center" style={{ width: 116, height: 116 }}>
      {[0, 1].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{ width: 74 + i * 24, height: 74 + i * 24, border: `1px solid ${BORDER}` }}
          animate={reduce ? undefined : { scale: [1, 1.04, 1], opacity: [0.9, 0.5, 0.9] }}
          transition={{ duration: 5 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
        />
      ))}
      <motion.div
        className="relative flex h-[62px] w-[62px] items-center justify-center rounded-full"
        style={{ background: CHARCOAL, boxShadow: INSET_SHADOW }}
        animate={reduce ? undefined : { y: [0, -3, 0] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
      >
        <Icon className="h-6 w-6" style={{ color: CREAM_SOFT }} strokeWidth={1.6} />
      </motion.div>
    </div>
  );
}

/* ---------------- form primitives ---------------- */

export function Field({
  icon,
  children,
  delay = 0,
}: {
  icon?: ReactNode;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...soft, delay }}
      className="flex h-[48px] items-center gap-2.5 rounded-[12px] px-3.5"
      style={{ background: CREAM_SOFT, border: `1px solid ${BORDER}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)" }}
    >
      {icon && <span style={{ color: MUTED }}>{icon}</span>}
      {children}
    </motion.div>
  );
}

export function Notice({ kind, children }: { kind: "error" | "info"; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
      className="rounded-[10px] px-3 py-2 text-[12.5px] leading-snug"
      style={{
        background: kind === "error" ? "rgba(180,40,40,0.08)" : "rgba(28,28,28,0.05)",
        color: kind === "error" ? DANGER : CHARCOAL,
        border: `1px solid ${kind === "error" ? "rgba(180,40,40,0.15)" : BORDER}`,
      }}
    >
      {children}
    </motion.div>
  );
}

interface PrimaryProps extends Omit<MotionProps, "children"> {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function PrimaryButton({ children, onClick, type = "button", disabled, loading, icon }: PrimaryProps) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      whileTap={disabled || loading ? undefined : { scale: 0.985, opacity: 0.9 }}
      transition={spring}
      className="group relative flex h-[46px] w-full items-center justify-center gap-2 rounded-[10px] text-[15px] disabled:opacity-60"
      style={{
        background: CHARCOAL,
        color: CREAM_SOFT,
        fontWeight: 500,
        letterSpacing: "-0.005em",
        boxShadow: INSET_SHADOW,
      }}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <span className="flex items-center gap-2">
          {children}
          {icon ?? <ArrowRight className="h-[15px] w-[15px] transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={1.8} />}
        </span>
      )}
    </motion.button>
  );
}

export function GhostButton({
  children,
  onClick,
  type = "button",
  disabled,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.985, opacity: 0.9 }}
      transition={spring}
      className="flex h-[46px] w-full items-center justify-center gap-2 rounded-[10px] text-[14.5px] disabled:opacity-60"
      style={{
        background: CREAM_SOFT,
        color: CHARCOAL,
        border: `1px solid ${BORDER}`,
        fontWeight: 500,
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}

export function TextLink({ children, onClick, type = "button" }: { children: ReactNode; onClick?: () => void; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="text-[13.5px] underline decoration-[rgba(28,28,28,0.35)] underline-offset-[3px] transition-colors hover:decoration-[rgba(28,28,28,0.7)]"
      style={{ color: CHARCOAL }}
    >
      {children}
    </button>
  );
}

export function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

/* ---------------- input base classes ---------------- */

export const inputClass =
  "w-full bg-transparent text-[15px] outline-none placeholder:text-[color:var(--aegis-muted)]";
export const inputStyle = { color: CHARCOAL, ["--aegis-muted" as string]: MUTED } as React.CSSProperties;
