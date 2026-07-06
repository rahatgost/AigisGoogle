import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, Lock } from "lucide-react";
import {
  BORDER,
  CHARCOAL,
  CREAM_SOFT,
  MUTED,
  inputClass,
  inputStyle,
  soft,
} from "@/components/aegis/chrome";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  minLength?: number;
  autoFocus?: boolean;
  required?: boolean;
  delay?: number;
  icon?: React.ReactNode;
}

/** Password / passphrase input with show-hide toggle + caps-lock warning. */
export function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete = "current-password",
  minLength,
  autoFocus,
  required = true,
  delay = 0,
  icon,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typeof e.getModifierState === "function") {
        setCaps(e.getModifierState("CapsLock"));
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...soft, delay }}
        className="flex h-[48px] items-center gap-2.5 rounded-[12px] px-3.5"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        <span style={{ color: MUTED }}>
          {icon ?? <Lock className="h-4 w-4" strokeWidth={1.6} />}
        </span>
        <input
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          autoFocus={autoFocus}
          minLength={minLength}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="rounded p-1 transition-opacity hover:opacity-100"
          style={{ color: MUTED, opacity: 0.7 }}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" strokeWidth={1.6} />
          ) : (
            <Eye className="h-4 w-4" strokeWidth={1.6} />
          )}
        </button>
      </motion.div>
      {caps && value.length > 0 && (
        <p className="px-1 text-[11.5px]" style={{ color: MUTED }}>
          Caps Lock is on.
        </p>
      )}
    </div>
  );
}

/** Simple 0-4 strength score based on length + character variety. */
export function scoreStrength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);
}

const STRENGTH_LABELS = ["Too short", "Weak", "Okay", "Strong", "Excellent"];
const STRENGTH_COLORS = [
  "rgb(var(--aegis-danger-rgb) / 0.85)",
  "rgba(200,110,40,0.9)",
  "rgba(180,150,40,0.9)",
  "rgba(60,140,90,0.9)",
  "rgba(40,120,70,0.95)",
];

export function StrengthMeter({ value }: { value: string }) {
  const score = scoreStrength(value);
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 px-1">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{
              background: i < score ? STRENGTH_COLORS[score] : "rgb(var(--aegis-ink-rgb) / 0.08)",
            }}
          />
        ))}
      </div>
      <span className="text-[11px] tabular-nums" style={{ color: CHARCOAL, opacity: 0.75 }}>
        {STRENGTH_LABELS[score]}
      </span>
    </div>
  );
}
