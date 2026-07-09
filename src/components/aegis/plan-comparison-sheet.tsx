import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { COMPARISON_ROWS } from "@/lib/plan";

/**
 * Bottom-sheet comparison showing the Free/Pro/Family matrix. Reused from
 * Profile's "See what's in Pro" link. Copy is driven by `plan.ts` so it
 * cannot drift from enforced limits.
 */
export function PlanComparisonSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40"
            style={{ background: "rgb(0 0 0 / 0.35)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85vh] w-full max-w-[440px] flex-col rounded-t-[20px]"
            style={{
              background: "var(--aegis-cream)",
              border: "1px solid var(--aegis-border)",
              paddingBottom: "max(20px, env(safe-area-inset-bottom))",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <div
                className="text-[16px]"
                style={{ color: "var(--aegis-ink)", fontWeight: 600 }}
              >
                Compare plans
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ color: "var(--aegis-ink)" }}
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>

            <div className="overflow-y-auto px-5 pb-2">
              <div
                className="grid grid-cols-[1.4fr_repeat(3,1fr)] items-center gap-x-2 border-b py-2 text-[11px] uppercase"
                style={{
                  borderColor: "var(--aegis-border)",
                  color: "var(--aegis-muted)",
                  letterSpacing: "0.08em",
                  fontWeight: 500,
                }}
              >
                <div />
                <div className="text-center">Free</div>
                <div className="text-center">Pro</div>
                <div className="text-center">Family</div>
              </div>
              {COMPARISON_ROWS.map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[1.4fr_repeat(3,1fr)] items-center gap-x-2 border-b py-2.5 text-[13px]"
                  style={{
                    borderColor: "var(--aegis-border)",
                    color: "var(--aegis-ink)",
                  }}
                >
                  <div style={{ fontWeight: 500 }}>{row.label}</div>
                  <div
                    className="text-center"
                    style={{ color: "var(--aegis-muted)" }}
                  >
                    {row.free}
                  </div>
                  <div className="text-center">{row.pro}</div>
                  <div className="text-center">{row.family}</div>
                </div>
              ))}
              <div
                className="mt-3 flex items-center justify-around text-[12.5px]"
                style={{ color: "var(--aegis-muted)" }}
              >
                <span>Free — $0</span>
                <span>Pro — $2.99/mo</span>
                <span>Family — $4.99/mo</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
