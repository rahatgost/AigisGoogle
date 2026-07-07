/**
 * Apple-style numeric PIN pad for vault unlock.
 * Controlled input: parent owns the digit string, we render dots + keypad.
 */

import { motion } from "framer-motion";
import { Delete } from "lucide-react";
import { CHARCOAL, MUTED, soft } from "@/components/aegis/chrome";

interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  length?: number; // max digits, default 6
  minLength?: number; // min digits before auto-submit is allowed
  onComplete?: (pin: string) => void; // fires when value reaches `length`
  shake?: boolean; // trigger shake animation on wrong PIN
  disabled?: boolean;
}

export function PinPad({
  value,
  onChange,
  length = 6,
  onComplete,
  shake,
  disabled,
}: PinPadProps) {
  const dots = Array.from({ length }, (_, i) => i < value.length);

  const press = (digit: string) => {
    if (disabled) return;
    if (value.length >= length) return;
    const next = value + digit;
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  const backspace = () => {
    if (disabled) return;
    if (value.length === 0) return;
    onChange(value.slice(0, -1));
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

  return (
    <div className="flex flex-col items-center gap-5 select-none sm:gap-8">
      {/* dots */}
      <motion.div
        className="flex items-center gap-3 sm:gap-4"
        animate={shake ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
        transition={{ duration: 0.45 }}
      >
        {dots.map((filled, i) => (
          <motion.div
            key={i}
            initial={false}
            animate={{
              scale: filled ? 1 : 0.75,
              backgroundColor: filled ? CHARCOAL : "transparent",
            }}
            transition={soft}
            className="h-3 w-3 rounded-full"
            style={{
              border: `1.5px solid ${filled ? CHARCOAL : "rgb(var(--aegis-ink-rgb) / 0.35)"}`,
            }}
          />
        ))}
      </motion.div>

      {/* keypad */}
      <div className="grid grid-cols-3 gap-3">
        {keys.map((k, i) => {
          if (k === "") return <div key={i} />;
          if (k === "back") {
            return (
              <motion.button
                key={i}
                type="button"
                onClick={backspace}
                disabled={disabled || value.length === 0}
                whileTap={{ scale: 0.92, opacity: 0.7 }}
                transition={soft}
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full disabled:opacity-40 sm:h-[60px] sm:w-[60px]"
                style={{ color: MUTED }}
                aria-label="Delete last digit"
              >
                <Delete className="h-5 w-5" strokeWidth={1.6} />
              </motion.button>
            );
          }
          return (
            <motion.button
              key={i}
              type="button"
              onClick={() => press(k)}
              disabled={disabled}
              whileTap={{ scale: 0.9, backgroundColor: "rgb(var(--aegis-ink-rgb) / 0.08)" }}
              transition={soft}
              className="flex h-[52px] w-[52px] items-center justify-center rounded-full text-[22px] disabled:opacity-40 sm:h-[60px] sm:w-[60px] sm:text-[26px]"
              style={{
                color: CHARCOAL,
                fontWeight: 300,
                letterSpacing: "-0.02em",
                background: "rgb(var(--aegis-ink-rgb) / 0.04)",
              }}
              aria-label={`Digit ${k}`}
            >
              {k}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
