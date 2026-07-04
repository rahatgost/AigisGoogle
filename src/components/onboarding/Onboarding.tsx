import { useState, useMemo, type ReactNode } from "react";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import {
  Shield,
  Zap,
  Lock,
  RefreshCw,
  QrCode,
  Upload,
  KeyRound,
  CloudUpload,
  Bell,
  Fingerprint,
  Check,
  ArrowRight,
  Sparkles,
  ChevronLeft,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Motion tokens                                                              */
/* -------------------------------------------------------------------------- */

const spring = { type: "spring" as const, stiffness: 280, damping: 28, mass: 0.8 };
const softSpring = { type: "spring" as const, stiffness: 220, damping: 30, mass: 0.9 };
const gentle = { type: "spring" as const, stiffness: 160, damping: 24, mass: 1 };

/* -------------------------------------------------------------------------- */
/*  Shell                                                                      */
/* -------------------------------------------------------------------------- */

function AmbientBackground() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* base */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 60% at 50% 0%, color-mix(in oklab, var(--color-primary) 8%, transparent), transparent 60%), linear-gradient(180deg, #F8F9FB 0%, #F3F5F9 100%)",
        }}
      />
      {/* slow breathing orbs */}
      <motion.div
        className="absolute -left-24 top-1/4 h-[360px] w-[360px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--color-primary) 22%, transparent), transparent 70%)",
          filter: "blur(60px)",
        }}
        animate={reduce ? undefined : { x: [0, 30, 0], y: [0, -20, 0], opacity: [0.5, 0.75, 0.5] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-24 bottom-1/4 h-[420px] w-[420px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--color-accent) 20%, transparent), transparent 70%)",
          filter: "blur(70px)",
        }}
        animate={reduce ? undefined : { x: [0, -30, 0], y: [0, 20, 0], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* subtle grain */}
      <div
        className="absolute inset-0 opacity-[0.35] mix-blend-overlay"
        style={{
          backgroundImage:
            "radial-gradient(rgba(15,23,42,0.06) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="relative h-[3px] w-40 overflow-hidden rounded-full bg-black/[0.06]">
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: "linear-gradient(90deg, var(--color-primary), var(--color-accent))" }}
        initial={false}
        animate={{ width: `${((current + 1) / total) * 100}%` }}
        transition={softSpring}
      />
    </div>
  );
}

function TopBar({
  step,
  total,
  onBack,
  onSkip,
  canSkip,
}: {
  step: number;
  total: number;
  onBack?: () => void;
  onSkip?: () => void;
  canSkip: boolean;
}) {
  return (
    <header className="relative z-10 flex items-center justify-between px-5 pt-3">
      <div className="flex w-16 justify-start">
        <AnimatePresence initial={false}>
          {step > 0 && (
            <motion.button
              key="back"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={spring}
              whileTap={{ scale: 0.9 }}
              onClick={onBack}
              aria-label="Back"
              className="flex h-10 w-10 items-center justify-center rounded-full text-foreground/60 backdrop-blur transition-colors hover:bg-black/[0.05] hover:text-foreground"
            >
              <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <ProgressBar current={step} total={total} />
      <div className="flex w-16 justify-end">
        {canSkip && (
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={onSkip}
            className="rounded-full px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip
          </motion.button>
        )}
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/*  Buttons                                                                    */
/* -------------------------------------------------------------------------- */

function PrimaryButton({
  children,
  onClick,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      transition={spring}
      className="group relative flex h-[54px] w-full items-center justify-center gap-2 overflow-hidden rounded-[18px] text-[17px] font-semibold tracking-[-0.01em] text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      style={{
        background: "linear-gradient(180deg, #3B82F6 0%, #2563EB 100%)",
        boxShadow:
          "0 1px 0 0 rgba(255,255,255,0.25) inset, 0 10px 26px -12px rgba(37,99,235,0.6), 0 4px 12px -4px rgba(37,99,235,0.35)",
      }}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-[18px] bg-gradient-to-b from-white/25 to-transparent" />
      {/* shimmer */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
        }}
        initial={{ x: "-120%" }}
        animate={{ x: "120%" }}
        transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 2.4, ease: "easeInOut" }}
      />
      <span className="relative flex items-center gap-2">
        {children}
        {icon ?? (
          <ArrowRight
            className="h-[18px] w-[18px] transition-transform duration-300 group-hover:translate-x-0.5"
            strokeWidth={2.4}
          />
        )}
      </span>
    </motion.button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      transition={spring}
      className="flex h-[52px] w-full items-center justify-center rounded-[18px] text-[15.5px] font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {children}
    </motion.button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Typography                                                                 */
/* -------------------------------------------------------------------------- */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.02 }}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary/[0.08] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-primary"
    >
      {children}
    </motion.span>
  );
}

function Headline({
  title,
  subtitle,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="px-8 text-center">
      {eyebrow && <div className="mb-4">{eyebrow}</div>}
      <motion.h1
        initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ ...spring, delay: 0.06 }}
        className="font-display text-[38px] font-bold leading-[1.05] tracking-[-0.035em] text-foreground sm:text-[44px]"
      >
        {title}
      </motion.h1>
      {subtitle && (
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.16 }}
          className="mx-auto mt-4 max-w-[340px] text-[16.5px] font-normal leading-[1.45] tracking-[-0.005em] text-muted-foreground"
        >
          {subtitle}
        </motion.p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hero — layered shield with orbiting particles + parallax                   */
/* -------------------------------------------------------------------------- */

function HeroIllustration() {
  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useTransform(my, [-40, 40], [8, -8]);
  const ry = useTransform(mx, [-40, 40], [-8, 8]);

  return (
    <div
      className="relative flex h-[300px] w-full items-center justify-center"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set(e.clientX - r.left - r.width / 2);
        my.set(e.clientY - r.top - r.height / 2);
      }}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
      style={{ perspective: 1000 }}
    >
      {/* concentric rings */}
      {[220, 280, 340].map((size, i) => (
        <motion.div
          key={size}
          aria-hidden
          className="absolute rounded-full border"
          style={{
            width: size,
            height: size,
            borderColor: `color-mix(in oklab, var(--color-primary) ${14 - i * 3}%, transparent)`,
          }}
          animate={
            reduce
              ? undefined
              : { scale: [1, 1.03, 1], opacity: [0.55, 0.9, 0.55] }
          }
          transition={{ duration: 5 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
        />
      ))}

      {/* orbiting particles */}
      {[...Array(8)].map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        const radius = 135 + (i % 2) * 18;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const size = i % 3 === 0 ? 6 : 3;
        return (
          <motion.span
            key={i}
            aria-hidden
            className="absolute rounded-full"
            style={{
              x,
              y,
              width: size,
              height: size,
              background: i % 2 === 0 ? "var(--color-primary)" : "var(--color-accent)",
              boxShadow:
                "0 0 12px color-mix(in oklab, var(--color-primary) 70%, transparent)",
            }}
            animate={
              reduce
                ? undefined
                : { opacity: [0.25, 1, 0.25], scale: [0.7, 1.15, 0.7] }
            }
            transition={{
              duration: 2.6 + (i % 4) * 0.4,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.2,
            }}
          />
        );
      })}

      {/* rotating faint ring dashed */}
      <motion.svg
        aria-hidden
        viewBox="0 0 300 300"
        className="absolute h-[300px] w-[300px]"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
      >
        <circle
          cx="150"
          cy="150"
          r="140"
          fill="none"
          stroke="color-mix(in oklab, var(--color-primary) 22%, transparent)"
          strokeWidth="1"
          strokeDasharray="2 8"
        />
      </motion.svg>

      {/* shield card with parallax */}
      <motion.div
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        transition={gentle}
        className="relative"
      >
        <motion.div
          initial={{ scale: 0.85, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.15 }}
          className="relative flex h-[132px] w-[132px] items-center justify-center rounded-[34px]"
          style={{
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #F4F6FB 100%)",
            boxShadow:
              "0 1px 0 0 rgba(255,255,255,1) inset, 0 0 0 1px rgba(15,23,42,0.04), 0 30px 60px -20px rgba(37,99,235,0.35), 0 8px 20px -8px rgba(15,23,42,0.15)",
          }}
        >
          <motion.div
            animate={reduce ? undefined : { rotate: [0, 4, -4, 0], y: [0, -3, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          >
            <Shield
              className="h-[62px] w-[62px]"
              strokeWidth={1.4}
              style={{ color: "var(--color-primary)" }}
            />
          </motion.div>
          {/* inner check */}
          <motion.div
            className="absolute inset-x-0 bottom-[38px] mx-auto flex h-6 w-6 items-center justify-center rounded-full"
            style={{ background: "var(--color-primary)" }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...spring, delay: 0.6 }}
          >
            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function ScreenHero({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="relative flex flex-1 flex-col items-center justify-center gap-10 px-6">
        <HeroIllustration />
        <Headline
          eyebrow={<Eyebrow>Welcome to Aegis</Eyebrow>}
          title={<>Security that <br /> simply works.</>}
          subtitle="Protect every account with secure one-time codes — quiet, elegant, and private by design."
        />
      </div>
      <div className="px-6 pb-8 pt-4">
        <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Why — premium feature cards                                                */
/* -------------------------------------------------------------------------- */

function FeatureCard({
  index,
  icon,
  title,
  description,
  delay,
  tint,
}: {
  index: string;
  icon: ReactNode;
  title: string;
  description: string;
  delay: number;
  tint: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ ...spring, delay }}
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-[28px] bg-card p-5"
      style={{
        boxShadow:
          "0 1px 0 0 rgba(255,255,255,0.7) inset, 0 0 0 1px rgba(15,23,42,0.05), 0 14px 34px -22px rgba(15,23,42,0.22), 0 2px 6px -2px rgba(15,23,42,0.05)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-70"
        style={{
          background: `radial-gradient(closest-side, ${tint}, transparent 70%)`,
          filter: "blur(20px)",
        }}
      />
      <div className="relative flex items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
          style={{
            background: "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0.4))",
            boxShadow:
              "0 0 0 1px rgba(15,23,42,0.05), 0 8px 20px -12px rgba(37,99,235,0.4)",
          }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-[18px] font-bold tracking-[-0.02em] text-foreground">
              {title}
            </h3>
            <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground/70">
              {index}
            </span>
          </div>
          <p className="mt-1 text-[14.5px] leading-[1.45] text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function ScreenWhy({ onNext }: { onNext: () => void }) {
  const items = [
    {
      icon: <Zap className="h-6 w-6" style={{ color: "var(--color-primary)" }} strokeWidth={2} />,
      title: "Fast",
      description: "Generate one-time codes the instant you need them.",
      tint: "color-mix(in oklab, var(--color-primary) 30%, transparent)",
    },
    {
      icon: <Lock className="h-6 w-6" style={{ color: "var(--color-primary)" }} strokeWidth={2} />,
      title: "Private",
      description: "Every secret is encrypted and stays on your device.",
      tint: "color-mix(in oklab, var(--color-accent) 30%, transparent)",
    },
    {
      icon: <RefreshCw className="h-6 w-6" style={{ color: "var(--color-primary)" }} strokeWidth={2} />,
      title: "Reliable",
      description: "Works offline. Never miss an authentication code.",
      tint: "color-mix(in oklab, var(--color-success) 26%, transparent)",
    },
  ];
  return (
    <div className="flex flex-1 flex-col">
      <div className="px-6 pt-6">
        <Headline
          eyebrow={<Eyebrow>Why Aegis</Eyebrow>}
          title={<>Designed for calm, <br /> everyday security.</>}
        />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-3 px-6 py-8">
        {items.map((it, i) => (
          <FeatureCard
            key={it.title}
            index={`0${i + 1}`}
            {...it}
            delay={0.14 + i * 0.1}
          />
        ))}
      </div>
      <div className="px-6 pb-8">
        <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Import — phone mockup with animated QR                                     */
/* -------------------------------------------------------------------------- */

function PhoneMockup() {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto flex items-center justify-center">
      {/* glow */}
      <motion.div
        aria-hidden
        className="absolute h-[320px] w-[240px] rounded-[60px]"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--color-primary) 22%, transparent), transparent 70%)",
          filter: "blur(40px)",
        }}
        animate={reduce ? undefined : { opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        initial={{ y: 24, opacity: 0, rotateX: -6 }}
        animate={{ y: 0, opacity: 1, rotateX: 0 }}
        transition={{ ...spring, delay: 0.1 }}
        className="relative h-[280px] w-[156px] rounded-[38px] p-[3px]"
        style={{
          background: "linear-gradient(180deg, #1E293B 0%, #0F172A 100%)",
          boxShadow:
            "0 30px 60px -20px rgba(15,23,42,0.5), 0 8px 20px -8px rgba(15,23,42,0.25), 0 0 0 1px rgba(255,255,255,0.06) inset",
        }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-[35px] bg-white">
          {/* dynamic island */}
          <div className="absolute left-1/2 top-2 h-4 w-14 -translate-x-1/2 rounded-full bg-[#0F172A]" />
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 pt-6">
            {/* QR */}
            <div
              className="relative flex h-[120px] w-[120px] items-center justify-center rounded-2xl"
              style={{
                background: "#F8F9FB",
                boxShadow: "0 0 0 1px rgba(15,23,42,0.06) inset",
              }}
            >
              <QrCode className="h-[86px] w-[86px] text-foreground/90" strokeWidth={1.4} />
              {/* scan beam */}
              <motion.div
                aria-hidden
                className="absolute inset-x-3 h-[2px] rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, var(--color-primary), transparent)",
                  boxShadow:
                    "0 0 14px color-mix(in oklab, var(--color-primary) 70%, transparent)",
                }}
                animate={reduce ? undefined : { top: ["10%", "88%", "10%"] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
              {/* corner brackets */}
              {[
                "top-1.5 left-1.5 border-l-2 border-t-2 rounded-tl-md",
                "top-1.5 right-1.5 border-r-2 border-t-2 rounded-tr-md",
                "bottom-1.5 left-1.5 border-l-2 border-b-2 rounded-bl-md",
                "bottom-1.5 right-1.5 border-r-2 border-b-2 rounded-br-md",
              ].map((c) => (
                <span
                  key={c}
                  className={`absolute h-4 w-4 ${c}`}
                  style={{ borderColor: "var(--color-primary)" }}
                />
              ))}
            </div>
            <div className="flex flex-col items-center gap-1">
              <p className="text-[11px] font-semibold text-foreground">Scanning</p>
              <p className="text-[10px] font-medium text-muted-foreground">Align QR to import</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function OptionRow({
  icon,
  label,
  hint,
  onClick,
  delay,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  onClick?: () => void;
  delay: number;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      whileTap={{ scale: 0.98 }}
      whileHover={{ y: -1 }}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[22px] bg-card px-4 py-3.5 text-left"
      style={{
        boxShadow:
          "0 1px 0 0 rgba(255,255,255,0.7) inset, 0 0 0 1px rgba(15,23,42,0.05), 0 10px 24px -18px rgba(15,23,42,0.22)",
      }}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--color-primary) 12%, white), color-mix(in oklab, var(--color-primary) 6%, white))",
        }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">{label}</p>
        <p className="truncate text-[12.5px] text-muted-foreground">{hint}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/70" strokeWidth={2.2} />
    </motion.button>
  );
}

function ScreenImport({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-start gap-6 px-6 pt-2">
        <PhoneMockup />
        <Headline
          title={<>Import in seconds.</>}
          subtitle="Bring existing accounts into Aegis your way."
        />
        <div className="flex w-full max-w-sm flex-col gap-2.5">
          <OptionRow
            icon={<QrCode className="h-5 w-5" style={{ color: "var(--color-primary)" }} strokeWidth={2} />}
            label="Scan QR"
            hint="Point your camera at a code"
            delay={0.18}
            onClick={onNext}
          />
          <OptionRow
            icon={<Upload className="h-5 w-5" style={{ color: "var(--color-primary)" }} strokeWidth={2} />}
            label="Import Backup"
            hint="Restore from an encrypted file"
            delay={0.26}
            onClick={onNext}
          />
          <OptionRow
            icon={<KeyRound className="h-5 w-5" style={{ color: "var(--color-primary)" }} strokeWidth={2} />}
            label="Manual Setup"
            hint="Enter a setup key by hand"
            delay={0.34}
            onClick={onNext}
          />
        </div>
      </div>
      <div className="px-6 pb-8 pt-6">
        <SecondaryButton onClick={onNext}>Skip for now</SecondaryButton>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Backup                                                                     */
/* -------------------------------------------------------------------------- */

function NativeSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative h-[31px] w-[51px] rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      style={{
        backgroundColor: checked
          ? "var(--color-success)"
          : "color-mix(in oklab, var(--color-foreground) 14%, transparent)",
      }}
    >
      <motion.span
        layout
        transition={spring}
        className="absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white"
        style={{
          left: checked ? 22 : 2,
          boxShadow:
            "0 3px 8px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.1)",
        }}
      />
    </button>
  );
}

function CloudVault() {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex h-[220px] items-center justify-center">
      <motion.div
        aria-hidden
        className="absolute h-64 w-64 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--color-primary) 20%, transparent), transparent 70%)",
          filter: "blur(30px)",
        }}
        animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* floating chips around */}
      {[
        { x: -80, y: -50, d: 0 },
        { x: 78, y: -40, d: 0.4 },
        { x: -70, y: 60, d: 0.8 },
        { x: 82, y: 55, d: 1.2 },
      ].map((p, i) => (
        <motion.div
          key={i}
          aria-hidden
          className="absolute flex h-8 w-8 items-center justify-center rounded-xl bg-card"
          style={{
            x: p.x,
            y: p.y,
            boxShadow:
              "0 0 0 1px rgba(15,23,42,0.05), 0 8px 18px -10px rgba(15,23,42,0.25)",
          }}
          animate={reduce ? undefined : { y: [p.y - 4, p.y + 4, p.y - 4] }}
          transition={{ duration: 4 + i * 0.4, repeat: Infinity, ease: "easeInOut", delay: p.d }}
        >
          <Lock className="h-4 w-4" strokeWidth={2} style={{ color: "var(--color-primary)" }} />
        </motion.div>
      ))}
      <motion.div
        initial={{ y: 12, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ ...spring, delay: 0.1 }}
        className="relative flex h-[132px] w-[132px] items-center justify-center rounded-[34px]"
        style={{
          background: "linear-gradient(180deg, #FFFFFF 0%, #F4F6FB 100%)",
          boxShadow:
            "0 1px 0 0 rgba(255,255,255,1) inset, 0 0 0 1px rgba(15,23,42,0.04), 0 30px 60px -22px rgba(37,99,235,0.3), 0 8px 20px -8px rgba(15,23,42,0.14)",
        }}
      >
        <CloudUpload
          className="h-[62px] w-[62px]"
          strokeWidth={1.4}
          style={{ color: "var(--color-primary)" }}
        />
        <motion.div
          aria-hidden
          className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full bg-card"
          style={{
            boxShadow:
              "0 0 0 1px rgba(15,23,42,0.05), 0 8px 20px -8px rgba(34,197,94,0.4)",
          }}
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ ...spring, delay: 0.35 }}
        >
          <Check className="h-4 w-4" strokeWidth={3} style={{ color: "var(--color-success)" }} />
        </motion.div>
      </motion.div>
    </div>
  );
}

function ScreenBackup({ onNext }: { onNext: () => void }) {
  const [enabled, setEnabled] = useState(true);
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
        <CloudVault />
        <Headline
          eyebrow={<Eyebrow>End-to-end encrypted</Eyebrow>}
          title={<>Backup, only for you.</>}
          subtitle="Your vault is encrypted on your device. No one — not even us — can read it."
        />
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.22 }}
          className="flex w-full max-w-sm items-center justify-between rounded-[22px] bg-card px-5 py-4"
          style={{
            boxShadow:
              "0 1px 0 0 rgba(255,255,255,0.7) inset, 0 0 0 1px rgba(15,23,42,0.05), 0 14px 34px -22px rgba(15,23,42,0.2)",
          }}
        >
          <div className="min-w-0 pr-4">
            <p className="text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">
              Automatic Backup
            </p>
            <p className="text-[13px] leading-snug text-muted-foreground">
              Keep your accounts safely synced.
            </p>
          </div>
          <NativeSwitch checked={enabled} onChange={setEnabled} />
        </motion.div>
      </div>
      <div className="px-6 pb-8 pt-6">
        <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Notifications                                                              */
/* -------------------------------------------------------------------------- */

function BellIllustration() {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex h-[220px] items-center justify-center">
      <motion.div
        aria-hidden
        className="absolute h-64 w-64 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--color-primary) 20%, transparent), transparent 70%)",
          filter: "blur(30px)",
        }}
        animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* ripples */}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute rounded-full border"
          style={{
            width: 150 + i * 40,
            height: 150 + i * 40,
            borderColor: "color-mix(in oklab, var(--color-primary) 20%, transparent)",
          }}
          animate={
            reduce
              ? undefined
              : { scale: [0.9, 1.06, 0.9], opacity: [0.1, 0.55, 0.1] }
          }
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
        />
      ))}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring}
        className="relative flex h-[132px] w-[132px] items-center justify-center rounded-[34px]"
        style={{
          background: "linear-gradient(180deg, #FFFFFF 0%, #F4F6FB 100%)",
          boxShadow:
            "0 1px 0 0 rgba(255,255,255,1) inset, 0 0 0 1px rgba(15,23,42,0.04), 0 30px 60px -22px rgba(37,99,235,0.3), 0 8px 20px -8px rgba(15,23,42,0.14)",
        }}
      >
        <motion.div
          animate={reduce ? undefined : { rotate: [0, -14, 14, -8, 8, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut" }}
          style={{ transformOrigin: "50% 22%" }}
        >
          <Bell
            className="h-[62px] w-[62px]"
            strokeWidth={1.4}
            style={{ color: "var(--color-primary)" }}
          />
        </motion.div>
        <motion.span
          aria-hidden
          className="absolute right-8 top-8 flex h-3.5 w-3.5 items-center justify-center rounded-full"
          style={{ background: "var(--color-destructive)" }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ ...spring, delay: 0.5 }}
        />
      </motion.div>
    </div>
  );
}

function ScreenNotifications({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-9 px-6">
        <BellIllustration />
        <Headline
          title={<>Stay in the loop.</>}
          subtitle="Gentle reminders for backups and important security updates. Nothing noisy."
        />
      </div>
      <div className="flex flex-col gap-1 px-6 pb-8">
        <PrimaryButton onClick={onNext}>Allow Notifications</PrimaryButton>
        <SecondaryButton onClick={onNext}>Maybe Later</SecondaryButton>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Biometrics                                                                 */
/* -------------------------------------------------------------------------- */

function FingerprintIllustration() {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex h-[240px] items-center justify-center">
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute rounded-full border"
          style={{
            width: 150 + i * 40,
            height: 150 + i * 40,
            borderColor: `color-mix(in oklab, var(--color-primary) ${18 - i * 3}%, transparent)`,
          }}
          animate={
            reduce
              ? undefined
              : { scale: [0.92, 1.06, 0.92], opacity: [0.15, 0.7, 0.15] }
          }
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.35 }}
        />
      ))}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring}
        className="relative flex h-[132px] w-[132px] items-center justify-center rounded-[34px]"
        style={{
          background: "linear-gradient(180deg, #FFFFFF 0%, #F4F6FB 100%)",
          boxShadow:
            "0 1px 0 0 rgba(255,255,255,1) inset, 0 0 0 1px rgba(15,23,42,0.04), 0 30px 60px -22px rgba(37,99,235,0.35), 0 8px 20px -8px rgba(15,23,42,0.14)",
        }}
      >
        <motion.div
          animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Fingerprint
            className="h-[68px] w-[68px]"
            strokeWidth={1.3}
            style={{ color: "var(--color-primary)" }}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

function ScreenBiometrics({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-10 px-6">
        <FingerprintIllustration />
        <Headline
          title={<>Unlock with a touch.</>}
          subtitle="Use Face ID or your fingerprint to open Aegis instantly."
        />
      </div>
      <div className="flex flex-col gap-1 px-6 pb-8">
        <PrimaryButton onClick={onNext}>Enable Biometrics</PrimaryButton>
        <SecondaryButton onClick={onNext}>Not now</SecondaryButton>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Final                                                                      */
/* -------------------------------------------------------------------------- */

function Confetti() {
  const reduce = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: 22 }).map((_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 320,
        delay: Math.random() * 0.5,
        rot: Math.random() * 200,
        color:
          i % 3 === 0
            ? "var(--color-primary)"
            : i % 3 === 1
              ? "var(--color-success)"
              : "color-mix(in oklab, var(--color-accent) 80%, white)",
      })),
    [],
  );
  if (reduce) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute left-1/2 top-[38%] h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: p.color }}
          initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
          animate={{
            opacity: [0, 1, 0],
            x: p.x,
            y: 260 + Math.random() * 140,
            scale: [0, 1, 0.6],
            rotate: p.rot,
          }}
          transition={{ duration: 1.9, delay: p.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

function BigShield() {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex h-[240px] items-center justify-center">
      <motion.div
        aria-hidden
        className="absolute h-72 w-72 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--color-success) 22%, transparent), transparent 70%)",
          filter: "blur(36px)",
        }}
        animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring}
        className="relative flex h-[148px] w-[148px] items-center justify-center rounded-[38px]"
        style={{
          background: "linear-gradient(180deg, #FFFFFF 0%, #F4F6FB 100%)",
          boxShadow:
            "0 1px 0 0 rgba(255,255,255,1) inset, 0 0 0 1px rgba(15,23,42,0.05), 0 32px 70px -22px rgba(37,99,235,0.4), 0 8px 20px -8px rgba(15,23,42,0.16)",
        }}
      >
        <Shield
          className="h-[76px] w-[76px]"
          strokeWidth={1.4}
          style={{ color: "var(--color-primary)" }}
        />
        <motion.div
          aria-hidden
          className="absolute -bottom-2 -right-2 flex h-11 w-11 items-center justify-center rounded-full bg-card"
          style={{
            boxShadow:
              "0 0 0 1px rgba(15,23,42,0.05), 0 10px 24px -8px rgba(34,197,94,0.5)",
          }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ ...spring, delay: 0.4 }}
        >
          <Check
            className="h-5 w-5"
            strokeWidth={3}
            style={{ color: "var(--color-success)" }}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

function ScreenFinal({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="relative flex flex-1 flex-col">
      <Confetti />
      <div className="flex flex-1 flex-col items-center justify-center gap-10 px-6">
        <BigShield />
        <Headline
          eyebrow={<Eyebrow>All set</Eyebrow>}
          title={<>You're protected.</>}
          subtitle="Your authenticator is ready. Welcome to a quieter kind of security."
        />
      </div>
      <div className="flex flex-col gap-1 px-6 pb-8">
        <PrimaryButton onClick={onRestart} icon={<Sparkles className="h-[18px] w-[18px]" />}>
          Get Started
        </PrimaryButton>
        <SecondaryButton onClick={onRestart}>Explore Settings</SecondaryButton>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Root                                                                       */
/* -------------------------------------------------------------------------- */

const screens = [
  "hero",
  "why",
  "import",
  "backup",
  "notifications",
  "biometrics",
  "final",
] as const;

const skippable = new Set(["import", "backup", "notifications", "biometrics"]);

const pageVariants = {
  enter: (dir: number) => ({
    opacity: 0,
    x: dir > 0 ? 40 : -40,
    filter: "blur(10px)",
  }),
  center: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir > 0 ? -40 : 40,
    filter: "blur(10px)",
  }),
};

export default function Onboarding() {
  const [[step, dir], setStep] = useState<[number, number]>([0, 1]);
  const total = screens.length;

  const goTo = (target: number) => {
    const bounded = Math.max(0, Math.min(target, total - 1));
    setStep(([current]) => [bounded, bounded > current ? 1 : -1]);
  };
  const next = () => goTo(step + 1);
  const back = () => goTo(step - 1);
  const restart = () => setStep([0, -1]);

  const current = screens[step];

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const threshold = 60;
    if (info.offset.x < -threshold && step < total - 1) next();
    else if (info.offset.x > threshold && step > 0) back();
  };

  const screenNode = (() => {
    switch (current) {
      case "hero":
        return <ScreenHero onNext={next} />;
      case "why":
        return <ScreenWhy onNext={next} />;
      case "import":
        return <ScreenImport onNext={next} />;
      case "backup":
        return <ScreenBackup onNext={next} />;
      case "notifications":
        return <ScreenNotifications onNext={next} />;
      case "biometrics":
        return <ScreenBiometrics onNext={next} />;
      case "final":
        return <ScreenFinal onRestart={restart} />;
    }
  })();

  return (
    <main
      className="relative min-h-[100dvh] w-full overflow-hidden font-sans text-foreground antialiased"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <AmbientBackground />
      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[520px] flex-col">
        <TopBar
          step={step}
          total={total}
          onBack={back}
          onSkip={next}
          canSkip={skippable.has(current)}
        />
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ ...softSpring, filter: { duration: 0.35 } }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.18}
              onDragEnd={onDragEnd}
              className="flex flex-1 flex-col"
            >
              {screenNode}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
