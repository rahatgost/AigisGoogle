import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check } from "lucide-react";
import { generateCode, type DecryptedAccount } from "@/lib/vault-accounts";
import { BORDER, CHARCOAL, CREAM_SOFT, MUTED } from "@/components/aegis/chrome";

const DANGER = "#b23a2a";

interface Props {
  account: DecryptedAccount;
  now: number;
}

function formatCode(code: string): string {
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}

function initials(source: string): string {
  const s = source.trim();
  if (!s) return "?";
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : s.slice(0, 2);
  return chars.toUpperCase();
}

/* Deterministic warm hue per issuer for the initials chip */
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function AccountCard({ account, now }: Props) {
  const [copied, setCopied] = useState(false);

  const period = account.period;
  const elapsed = Math.floor(now / 1000) % period;
  const remaining = period - elapsed;
  const progress = elapsed / period;

  const code = useMemo(() => {
    try {
      return generateCode(account, now);
    } catch {
      return "------";
    }
  }, [account, now]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.replace(/\s/g, ""));
      setCopied(true);
      if (typeof navigator.vibrate === "function") navigator.vibrate(6);
    } catch {
      /* ignore */
    }
  };

  const warn = remaining <= 5;
  const seed = account.issuer || account.label || "?";
  const hue = hueFor(seed);
  const chipBg = `hsl(${hue}, 42%, 92%)`;
  const chipFg = `hsl(${hue}, 40%, 28%)`;

  return (
    <motion.button
      onClick={copy}
      whileTap={{ scale: 0.985 }}
      className="group relative flex w-full items-center gap-3 rounded-[14px] px-3.5 py-3 text-left"
      style={{
        background: CREAM_SOFT,
        border: `1px solid ${BORDER}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 1px 2px rgba(28,28,28,0.04)",
      }}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[13px] font-semibold tracking-wide"
        style={{ background: chipBg, color: chipFg, border: `1px solid ${BORDER}` }}
      >
        {initials(seed)}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-medium" style={{ color: CHARCOAL }}>
              {account.issuer || "Untitled"}
            </div>
            {account.label && (
              <div className="truncate text-[11.5px]" style={{ color: MUTED }}>
                {account.label}
              </div>
            )}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.div
                key="ok"
                initial={{ opacity: 0, scale: 0.85, y: -2 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.85, y: -2 }}
                transition={{ type: "spring", stiffness: 500, damping: 26 }}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px]"
                style={{ color: CHARCOAL, background: "rgba(28,28,28,0.06)" }}
              >
                <Check className="h-3 w-3" strokeWidth={2.2} />
                Copied
              </motion.div>
            ) : (
              <motion.div
                key="copy"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="opacity-50"
                style={{ color: MUTED }}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.6} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-1 flex items-baseline justify-between gap-3">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={code}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="font-mono text-[22px] leading-none tracking-[0.14em] tabular-nums"
              style={{ color: warn ? DANGER : CHARCOAL, fontFeatureSettings: "'tnum'" }}
            >
              {formatCode(code)}
            </motion.div>
          </AnimatePresence>
          <RingTimer progress={progress} remaining={remaining} warn={warn} />
        </div>
      </div>
    </motion.button>
  );
}

function RingTimer({ progress, remaining, warn }: { progress: number; remaining: number; warn: boolean }) {
  const size = 24;
  const stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * (1 - progress);
  const color = warn ? DANGER : CHARCOAL;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={BORDER} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={dash}
          style={{ transition: "stroke-dashoffset 0.24s linear, stroke 0.2s ease" }}
        />
      </svg>
      <span className="absolute text-[9.5px] font-medium tabular-nums" style={{ color, fontFeatureSettings: "'tnum'" }}>
        {remaining}
      </span>
    </div>
  );
}
