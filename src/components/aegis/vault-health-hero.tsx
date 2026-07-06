import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ShieldCheck, Lock } from "lucide-react";

import { BORDER, CHARCOAL, CREAM, DANGER, MUTED, soft } from "@/components/aegis/chrome";
import { getVaultKey, useVaultUnlocked } from "@/lib/vault-session";
import { listAccounts } from "@/lib/vault-accounts";
import { computeVaultHealth, type VaultHealthReport } from "@/lib/vault-health";
import { HealthSheet } from "@/components/aegis/vault-health-section";


/**
 * Vault health hero — a clean semi-circular gauge (Apple-style) that lives
 * at the top of the Security tab. Ticks around the perimeter, a small
 * indicator dot at the current score, and center label. Tap opens the
 * existing HealthSheet for the full breakdown.
 */

function scoreTone(score: number): { label: string; color: string } {
  if (score >= 85) return { label: "Healthy", color: "#2f8f5b" };
  if (score >= 60) return { label: "Fair", color: "#c9860b" };
  return { label: "Needs attention", color: DANGER };
}

// Gauge geometry — 270° arc opening at the bottom.
const CX = 140;
const CY = 130;
const R = 96;                       // arc radius
const START_DEG = 135;              // bottom-left
const SWEEP_DEG = 270;              // total arc span
const TICK_COUNT = 50;              // small ticks along the arc
const LABELED = [0, 20, 40, 60, 80, 100]; // score values that get a number

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function scoreToAngle(score: number) {
  const clamped = Math.max(0, Math.min(100, score));
  return START_DEG + (clamped / 100) * SWEEP_DEG;
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function VaultHealthHero() {
  const unlocked = useVaultUnlocked();
  const [report, setReport] = useState<VaultHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const scan = async () => {
    const dek = getVaultKey();
    if (!dek) {
      setErrorMsg("Vault is locked. Unlock to scan.");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const accounts = await listAccounts(dek);
      const next = await computeVaultHealth(accounts);
      setReport(next);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not scan the vault.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!unlocked) return;
    if (report || loading) return;
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  const tone = useMemo(
    () => (report ? scoreTone(report.score) : scoreTone(100)),
    [report],
  );

  const score = report?.score ?? 0;
  const showScore = unlocked && !loading && !!report;
  const angle = scoreToAngle(showScore ? score : 0);
  const filledPath = arcPath(CX, CY, R, START_DEG, angle);
  const trackPath = arcPath(CX, CY, R, START_DEG, START_DEG + SWEEP_DEG);
  const indicator = polar(CX, CY, R, angle);

  const findingCount = report
    ? report.duplicates.length + report.weakFavorites.length + report.missingIcons.length
    : 0;

  const subLine = !unlocked
    ? "Vault locked"
    : loading
      ? "Scanning your vault…"
      : errorMsg
        ? "Tap to retry"
        : findingCount === 0
          ? "All clear"
          : `${findingCount} ${findingCount === 1 ? "finding" : "findings"}`;

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setSheetOpen(true)}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={soft}
        whileTap={{ scale: 0.995 }}
        aria-label={
          showScore
            ? `Vault health score ${report!.score} of 100, ${tone.label}. Tap to view details.`
            : "Open vault health"
        }
        className="relative flex w-full flex-col items-center overflow-hidden rounded-[16px] px-4 pb-5 pt-6 focus-visible:outline-none focus-visible:ring-2"
        style={{
          background: CREAM,
          border: `1px solid ${BORDER}`,
        }}

      >
        {/* Section label */}
        <div className="mb-1 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} style={{ color: MUTED }} />
          <span
            className="text-[10.5px] uppercase"
            style={{ color: MUTED, letterSpacing: "0.18em", fontWeight: 600 }}
          >
            Vault health
          </span>
        </div>

        {/* Gauge */}
        <div className="relative w-full max-w-[300px]">
          <svg viewBox="0 0 280 210" className="block h-auto w-full" aria-hidden="true">
            {/* soft inner wash under the gauge */}
            <defs>
              <radialGradient id="gauge-wash" cx="50%" cy="65%" r="55%">
                <stop offset="0%" stopColor={tone.color} stopOpacity="0.10" />
                <stop offset="70%" stopColor={tone.color} stopOpacity="0.0" />
              </radialGradient>
            </defs>
            <circle cx={CX} cy={CY} r={R - 8} fill="url(#gauge-wash)" />

            {/* Track arc (very faint) */}
            <path
              d={trackPath}
              fill="none"
              stroke="rgb(var(--aegis-ink-rgb) / 0.08)"
              strokeWidth={1.2}
            />

            {/* Ticks */}
            {Array.from({ length: TICK_COUNT + 1 }).map((_, i) => {
              const t = i / TICK_COUNT;             // 0..1
              const s = Math.round(t * 100);        // score value at this tick
              const a = START_DEG + t * SWEEP_DEG;
              const isMajor = s % 10 === 0;
              const inner = polar(CX, CY, R - (isMajor ? 10 : 6), a);
              const outer = polar(CX, CY, R + (isMajor ? 2 : 0), a);
              const active = showScore && s <= score;
              return (
                <line
                  key={i}
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={active ? tone.color : "rgb(var(--aegis-ink-rgb) / 0.28)"}
                  strokeOpacity={active ? 0.9 : isMajor ? 0.75 : 0.45}
                  strokeWidth={isMajor ? 1.4 : 0.9}
                  strokeLinecap="round"
                />
              );
            })}

            {/* Numbered labels */}
            {LABELED.map((s) => {
              const a = scoreToAngle(s);
              const p = polar(CX, CY, R + 18, a);
              return (
                <text
                  key={s}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontFamily:
                      "ui-sans-serif, system-ui, -apple-system, 'SF Pro Text', sans-serif",
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: "0.02em",
                  }}
                  fill="rgb(var(--aegis-ink-rgb) / 0.5)"
                >
                  {s}
                </text>
              );
            })}

            {/* Filled arc up to score */}
            {showScore && (
              <motion.path
                d={filledPath}
                fill="none"
                stroke={tone.color}
                strokeOpacity={0.22}
                strokeWidth={3}
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              />
            )}

            {/* Indicator dot */}
            {showScore && (
              <motion.g
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                <circle
                  cx={indicator.x}
                  cy={indicator.y}
                  r={7}
                  fill={CREAM}
                  stroke={tone.color}
                  strokeWidth={2}
                />
                <circle cx={indicator.x} cy={indicator.y} r={2.6} fill={tone.color} />
              </motion.g>
            )}
          </svg>

          {/* Center readout — absolutely positioned over the gauge */}
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
            style={{ paddingBottom: "12%" }}
          >
            {!unlocked ? (
              <>
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full"
                  style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: MUTED }}
                >
                  <Lock className="h-4 w-4" strokeWidth={1.8} />
                </div>
                <div
                  className="mt-2 text-[11px] uppercase"
                  style={{ color: MUTED, letterSpacing: "0.14em", fontWeight: 600 }}
                >
                  Locked
                </div>
              </>
            ) : loading || !report ? (
              <>
                <div
                  className="h-9 w-16 animate-pulse rounded-md"
                  style={{ background: "rgb(var(--aegis-ink-rgb) / 0.08)" }}
                />
                <div
                  className="mt-2 h-3 w-20 animate-pulse rounded-full"
                  style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)" }}
                />
              </>
            ) : (
              <>
                <motion.span
                  key={report.score}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={soft}
                  className="leading-none"
                  style={{
                    color: CHARCOAL,
                    fontFamily: "'Playfair Display', serif",
                    fontWeight: 600,
                    fontSize: 48,
                    letterSpacing: "-1.2px",
                  }}
                >
                  {report.score}
                </motion.span>
                <span
                  className="mt-1.5 text-[10.5px] uppercase"
                  style={{
                    color: tone.color,
                    letterSpacing: "0.18em",
                    fontWeight: 600,
                  }}
                >
                  {tone.label}
                </span>

              </>
            )}
          </div>
        </div>

        {/* Sub line */}
        <div
          className="-mt-1 text-[12.5px]"
          style={{ color: MUTED, fontWeight: 500 }}
        >
          {subLine}
        </div>
      </motion.button>

      <AnimatePresence>
        {sheetOpen && (
          <HealthSheet
            report={report}
            loading={loading}
            errorMsg={errorMsg}
            unlocked={unlocked}
            onRescan={() => void scan()}
            onClose={() => setSheetOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
