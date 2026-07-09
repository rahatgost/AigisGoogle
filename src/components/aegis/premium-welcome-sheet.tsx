import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Infinity as InfinityIcon,
  CloudUpload,
  ShieldAlert,
  Chrome,
  Tags,
  History,
  Users,
  HomeIcon,
  LifeBuoy,
  Check,
} from "lucide-react";
import type { PlanTier } from "@/lib/plan";

/**
 * Celebratory sheet shown once, right after a Free→Pro/Family upgrade
 * completes (webhook flips subscription tier). Lists every feature the
 * user has just unlocked so the value of the plan is immediate and
 * visible — no digging through settings.
 */
const PRO_FEATURES = [
  { icon: InfinityIcon, title: "500 accounts", body: "20× more room than Free." },
  { icon: CloudUpload, title: "Auto cloud backup", body: "Encrypted, with 30-day history." },
  { icon: ShieldAlert, title: "Breach monitoring", body: "We watch HIBP so you don't have to." },
  { icon: Chrome, title: "Browser autofill", body: "One-click codes in the extension." },
  { icon: Tags, title: "Unlimited tags", body: "Organize your vault your way." },
  { icon: History, title: "90-day push history", body: "Full sign-in trail, not just 7 days." },
];

const FAMILY_EXTRAS = [
  { icon: Users, title: "Up to 6 members", body: "Invite the whole household." },
  { icon: HomeIcon, title: "Shared household vault", body: "Codes everyone can use." },
  { icon: LifeBuoy, title: "Emergency access", body: "Trusted recovery for loved ones." },
];

export function PremiumWelcomeSheet({
  open,
  tier,
  onClose,
}: {
  open: boolean;
  tier: PlanTier;
  onClose: () => void;
}) {
  const isFamily = tier === "family";
  const features = isFamily ? [...PRO_FEATURES, ...FAMILY_EXTRAS] : PRO_FEATURES;
  const label = isFamily ? "Family" : "Pro";

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40"
            style={{ background: "rgb(0 0 0 / 0.4)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92vh] w-full max-w-[440px] flex-col rounded-t-[22px]"
            style={{
              background: "var(--aegis-cream)",
              border: "1px solid var(--aegis-border)",
              paddingBottom: "max(20px, env(safe-area-inset-bottom))",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
          >
            <div
              className="mx-auto mt-3 h-1 w-10 rounded-full"
              style={{ background: "rgb(var(--aegis-ink-rgb) / 0.15)" }}
            />
            <div className="flex flex-col items-center px-6 pb-2 pt-5 text-center">
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}
                className="flex h-14 w-14 items-center justify-center rounded-full"
                style={{
                  background: "var(--aegis-ink)",
                  color: "var(--aegis-cream-soft)",
                }}
              >
                <Sparkles className="h-6 w-6" strokeWidth={1.8} />
              </motion.div>
              <div
                className="mt-3 text-[11px] uppercase"
                style={{
                  color: "var(--aegis-muted)",
                  letterSpacing: "0.14em",
                  fontWeight: 600,
                }}
              >
                Welcome to Aegis {label}
              </div>
              <div
                className="mt-1 text-[22px] leading-[1.15]"
                style={{
                  color: "var(--aegis-ink)",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                }}
              >
                You just unlocked{isFamily ? " everything." : " a lot."}
              </div>
              <div
                className="mt-1.5 text-[13px] leading-[1.5]"
                style={{ color: "var(--aegis-muted)" }}
              >
                Here's what's now available in your vault.
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pt-3">
              <div
                className="overflow-hidden rounded-[16px]"
                style={{
                  border: "1px solid var(--aegis-border)",
                  background: "var(--aegis-cream-soft)",
                }}
              >
                {features.map((f, i) => (
                  <motion.div
                    key={f.title}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.04 }}
                    className="flex items-start gap-3 px-4 py-3"
                    style={{
                      borderTop:
                        i === 0 ? undefined : "1px solid var(--aegis-border)",
                    }}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: "var(--aegis-ink)",
                        color: "var(--aegis-cream-soft)",
                      }}
                    >
                      <f.icon className="h-4 w-4" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[14px]"
                        style={{ color: "var(--aegis-ink)", fontWeight: 500 }}
                      >
                        {f.title}
                      </div>
                      <div
                        className="mt-0.5 text-[12.5px] leading-[1.45]"
                        style={{ color: "var(--aegis-muted)" }}
                      >
                        {f.body}
                      </div>
                    </div>
                    <Check
                      className="mt-2 h-4 w-4 shrink-0"
                      strokeWidth={2.4}
                      style={{ color: "var(--aegis-ink)" }}
                    />
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="px-5 pt-4">
              <button
                onClick={onClose}
                className="w-full rounded-[14px] py-3.5 text-[14.5px]"
                style={{
                  background: "var(--aegis-ink)",
                  color: "var(--aegis-cream-soft)",
                  fontWeight: 600,
                  letterSpacing: "-0.005em",
                }}
              >
                Start using {label}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
