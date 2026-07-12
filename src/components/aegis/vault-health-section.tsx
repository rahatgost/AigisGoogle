import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Copy,
  X,
} from "lucide-react";
import { useLingui } from "@lingui/react";

import { BORDER, CHARCOAL, CREAM, CREAM_SOFT, DANGER, MUTED, soft } from "@/components/aegis/chrome";
import { SettingsGroup, SettingsRow } from "@/components/aegis/settings";
import { getVaultKey, useVaultUnlocked } from "@/lib/vault-session";
import { listAccounts } from "@/lib/vault-accounts";
import {
  checkIssuerAgainstHibp,
  computeVaultHealth,
  type HibpResult,
  type VaultHealthReport,
} from "@/lib/vault-health";
import { usePlan } from "@/hooks/use-plan";
import { BreachUpgradeCard } from "@/components/aegis/breach-upgrade-card";


/**
 * Phase 9.3 — Vault health.
 *
 * A single collapsed row on the Security tab opens a bottom sheet with
 * a score, per-category findings, and an opt-in HIBP lookup per issuer.
 * All scanning happens client-side over already-decrypted accounts; no
 * secrets are logged or persisted.
 */

function scoreTone(score: number): { labelId: string; fallback: string; color: string; bar: string } {
  if (score >= 85) return { labelId: "vaultHealth.status.healthy", fallback: "Healthy", color: "#2f8f5b", bar: "#2f8f5b" };
  if (score >= 60) return { labelId: "vaultHealth.status.fair", fallback: "Fair", color: "#b0710d", bar: "#e0a30a" };
  return { labelId: "vaultHealth.status.needsAttention", fallback: "Needs attention", color: DANGER, bar: DANGER };
}

export function VaultHealthSection({ heading }: { heading?: string }) {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string, values?: Record<string, unknown>) => {
    const msg = values ? i18n._(id, values) : i18n._(id);
    return msg === id ? fallback : msg;
  };

  const finalHeading = heading || t("vaultHealth.section", "Vault health");
  const unlocked = useVaultUnlocked();


  const [report, setReport] = useState<VaultHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [politeMsg, setPoliteMsg] = useState("");
  const [assertiveMsg, setAssertiveMsg] = useState("");

  const announce = (text: string, tone: "polite" | "assertive" = "polite") => {
    if (tone === "assertive") {
      setAssertiveMsg("");
      window.setTimeout(() => setAssertiveMsg(text), 50);
    } else {
      setPoliteMsg("");
      window.setTimeout(() => setPoliteMsg(text), 50);
    }
  };

  const scan = async () => {
    const dek = getVaultKey();
    if (!dek) {
      const msg = t("vaultHealth.error.locked", "Vault is locked. Unlock to scan.");
      setErrorMsg(msg);
      announce(msg, "assertive");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const accounts = await listAccounts(dek);
      const next = await computeVaultHealth(accounts);
      setReport(next);
      const findings =
        next.duplicates.length + next.weakFavorites.length + next.missingIcons.length;

      if (findings === 0) {
        announce(t("vaultHealth.announce.perfect", "Vault health score {score} out of 100. No issues found.", { score: next.score }));
      } else {
        announce(t("vaultHealth.announce.findings", "Vault health score {score} out of 100. {count} {count, plural, one {finding} other {findings}}.", { score: next.score, count: findings }));
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : t("vaultHealth.error.generic", "Could not scan the vault.");
      setErrorMsg(text);
      toast.error(t("vaultHealth.toast.failed", "Vault health scan failed"), { description: text });
      announce(t("vaultHealth.announce.failed", "Vault health scan failed. {text}", { text }), "assertive");
    } finally {
      setLoading(false);
    }
  };

  // Auto-scan on first sheet open, only if unlocked and we have no report.
  useEffect(() => {
    if (!sheetOpen) return;
    if (!unlocked) return;
    if (report || loading) return;
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen, unlocked]);

  const findingCount = report
    ? report.duplicates.length + report.weakFavorites.length + report.missingIcons.length
    : 0;
  const summary = !unlocked
    ? t("vaultHealth.summary.locked", "Unlock the vault to run a health check")
    : report
      ? findingCount === 0
        ? t("vaultHealth.summary.perfect", "All clear · Score {score}/100", { score: report.score })
        : t("vaultHealth.summary.findings", "{count} {count, plural, one {finding} other {findings}} · Score {score}/100", { count: findingCount, score: report.score })
      : t("vaultHealth.summary.idle", "Tap to scan for duplicates, missing icons, and weak favourites");

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {politeMsg}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertiveMsg}
      </div>

      <SettingsGroup>
        <SettingsRow
          icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.8} />}
          title={finalHeading}
          description={summary}
          onClick={() => setSheetOpen(true)}
          chevron
          badge={
            findingCount > 0 ? String(findingCount) : report ? "✓" : undefined
          }
        />
      </SettingsGroup>

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

export function HealthSheet({
  report,
  loading,
  errorMsg,
  unlocked,
  onRescan,
  onClose,
}: {
  report: VaultHealthReport | null;
  loading: boolean;
  errorMsg: string | null;
  unlocked: boolean;
  onRescan: () => void;
  onClose: () => void;
}) {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string, values?: Record<string, unknown>) => {
    const msg = values ? i18n._(id, values) : i18n._(id);
    return msg === id ? fallback : msg;
  };

  const titleId = useId();
  const descId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [hibp, setHibp] = useState<Record<string, HibpResult | "loading">>({});
  const plan = usePlan();
  const canBreachScan = plan.hasFeature("breach-monitoring");


  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const root = sheetRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const runHibp = async (issuer: string) => {
    setHibp((prev) => ({ ...prev, [issuer]: "loading" }));
    const result = await checkIssuerAgainstHibp(issuer);
    setHibp((prev) => ({ ...prev, [issuer]: result }));
  };

  const tone = useMemo(
    () => (report ? scoreTone(report.score) : scoreTone(100)),
    [report],
  );

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onKeyDown={handleKeyDown}
    >
      <motion.div
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 cursor-pointer"
        style={{
          background: "rgb(var(--aegis-ink-rgb) / 0.35)",
          backdropFilter: "blur(4px)",
        }}
      />
      <motion.div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto flex max-h-[88vh] w-full max-w-[440px] flex-col rounded-t-[16px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[16px] focus:outline-none"
        style={{
          background: CREAM,
          border: `1px solid ${BORDER}`,
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-4 h-[4px] w-10 shrink-0 rounded-full"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.12)" }}
        />

        <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[24px]"
              style={{
                fontWeight: 600,
                letterSpacing: "-0.5px",
                lineHeight: 1.1,
                color: CHARCOAL,
              }}
            >
              {t("vaultHealth.title", "Vault health")}
            </h2>
            <div id={descId} className="mt-1.5 text-[13px]" style={{ color: MUTED, lineHeight: 1.5 }}>
              {t("vaultHealth.disclaimer", "Everything below runs on this device. Your secrets never leave the vault.")}
            </div>
          </div>
          <motion.button
            ref={closeBtnRef}
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2"
            style={{
              background: "transparent",
              border: `1px solid rgb(var(--aegis-ink-rgb) / 0.4)`,
              color: CHARCOAL,
            }}
            aria-label={t("vaultHealth.closeAria", "Close vault health")}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </motion.button>
        </div>


        <div className="min-h-0 flex-1 overflow-y-auto pb-1">
          {!unlocked && (
            <div
              className="rounded-[12px] px-4 py-6 text-center text-[13px]"
              style={{
                background: CREAM,
                border: `1px solid ${BORDER}`,
                color: MUTED,
                lineHeight: 1.5,
              }}
            >
              {t("vaultHealth.lockedMsg", "Unlock the vault to run a health scan.")}
            </div>
          )}

          {unlocked && loading && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: MUTED }} />
              <div className="text-[13px]" style={{ color: MUTED }}>
                {t("vaultHealth.loadingMsg", "Hashing secrets in memory…")}
              </div>
            </div>
          )}

          {unlocked && !loading && errorMsg && (
            <div
              role="alert"
              className="rounded-[12px] px-4 py-6 text-center text-[13px]"
              style={{
                background: CREAM,
                border: `1px solid ${BORDER}`,
                color: CHARCOAL,
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 600 }}>{t("vaultHealth.sheetError.title", "Vault health scan failed")}</div>
              <div className="mt-1 text-[13px]" style={{ color: MUTED }}>
                {errorMsg}
              </div>
              <button
                type="button"
                onClick={onRescan}
                className="mt-4 inline-flex items-center gap-1.5 rounded-[6px] px-4 py-2 text-[14px]"
                style={{
                  background: CHARCOAL,
                  color: CREAM_SOFT,
                  fontWeight: 400,
                  boxShadow:
                    "rgba(255,255,255,0.2) 0 0.5px 0 0 inset, rgba(0,0,0,0.2) 0 0 0 0.5px inset, rgba(0,0,0,0.05) 0 1px 2px 0",
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                {t("vaultHealth.button.tryAgain", "Try again")}
              </button>
            </div>
          )}

          {unlocked && !loading && !errorMsg && report && (
            <div className="space-y-5">
              {/* Score card */}
              <div
                className="rounded-[12px] px-4 py-5"
                style={{
                  background: CREAM,
                  border: `1px solid ${BORDER}`,
                }}
                aria-label={t("vaultHealth.scoreAria", "Vault health score {score} out of 100, {label}", { score: report.score, label: t(tone.labelId, tone.fallback) })}
              >
                <div className="flex items-baseline justify-between">
                  <div
                    className="text-[10.5px] uppercase"
                    style={{ color: MUTED, letterSpacing: "0.18em", fontWeight: 600 }}
                  >
                    {t("vaultHealth.label.score", "Score")}
                  </div>
                  <div
                    className="text-[10.5px] uppercase"
                    style={{ color: tone.color, letterSpacing: "0.18em", fontWeight: 600 }}
                  >
                    {t(tone.labelId, tone.fallback)}
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    style={{
                      color: CHARCOAL,
                      fontWeight: 600,
                      fontSize: 56,
                      letterSpacing: "-1.5px",
                      lineHeight: 1,
                    }}
                  >
                    {report.score}
                  </span>
                  <span className="text-[14px]" style={{ color: MUTED }}>
                    / 100
                  </span>
                  <span className="ml-auto text-[13px]" style={{ color: MUTED }}>
                    {t("vaultHealth.label.accountCount", "{count} {count, plural, one {account} other {accounts}}", { count: report.totalAccounts })}
                  </span>
                </div>
                <div
                  className="mt-4 h-[3px] w-full overflow-hidden rounded-full"
                  style={{ background: "rgb(var(--aegis-ink-rgb) / 0.08)" }}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${report.score}%` }}
                    transition={soft}
                    className="h-full rounded-full"
                    style={{ background: tone.bar }}
                  />
                </div>
                <button
                  type="button"
                  onClick={onRescan}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[13px]"
                  style={{
                    background: "transparent",
                    border: `1px solid rgb(var(--aegis-ink-rgb) / 0.4)`,
                    color: CHARCOAL,
                    fontWeight: 400,
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {t("vaultHealth.button.rescan", "Rescan")}
                </button>
              </div>

              {/* Duplicates */}
              <Category

                icon={<Copy className="h-3.5 w-3.5" strokeWidth={2} />}
                title={t("vaultHealth.duplicates.title", "Duplicate secrets")}
                emptyText={t("vaultHealth.duplicates.empty", "No duplicate TOTP secrets — every account has a unique key.")}
                count={report.duplicates.length}
                severity="warn"
              >
                {report.duplicates.map((d) => (
                  <div
                    key={d.groupId}
                    className="rounded-[12px] px-3 py-2.5"
                    style={{
                      background: CREAM,
                      border: `1px solid ${BORDER}`,
                    }}
                  >
                    <div
                      className="text-[11px] uppercase"
                      style={{ color: MUTED, letterSpacing: "0.12em", fontWeight: 600 }}
                    >
                      {t("vaultHealth.duplicates.groupLabel", "Group #{id}", { id: d.groupId })}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {d.labels.map((l) => (
                        <li key={l.id} className="text-[13px]" style={{ color: CHARCOAL }}>
                          <span style={{ fontWeight: 600 }}>{l.issuer || t("vaultHealth.issuer.unknown", "Unknown")}</span>
                          {l.label && (
                            <span style={{ color: MUTED }}> · {l.label}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-1 text-[11.5px]" style={{ color: MUTED }}>
                      {t("vaultHealth.duplicates.explanation", "These accounts share the same TOTP secret. If that's not intentional (e.g. same site with two labels), consider deleting the duplicates.")}
                    </div>
                  </div>
                ))}
              </Category>

              {/* Weak favourites */}
              <Category
                icon={<Heart className="h-3.5 w-3.5" strokeWidth={2} />}
                title={t("vaultHealth.weakFavorites.title", "Weak favourites")}
                emptyText={t("vaultHealth.weakFavorites.empty", "Every favourite is tied to a recognised issuer.")}
                count={report.weakFavorites.length}
                severity="warn"
              >
                {report.weakFavorites.map((w) => (
                  <div
                    key={w.accountId}
                    className="flex items-start gap-3 rounded-[12px] px-3 py-2.5"
                    style={{
                      background: CREAM,
                      border: `1px solid ${BORDER}`,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]" style={{ color: CHARCOAL, fontWeight: 600 }}>
                        {w.issuer || t("vaultHealth.issuer.unknown", "Unknown")}
                      </div>
                      {w.label && (
                        <div className="truncate text-[12px]" style={{ color: MUTED }}>
                          {w.label}
                        </div>
                      )}
                      <div className="mt-0.5 text-[11.5px]" style={{ color: MUTED }}>
                        {w.reason === "no_domain"
                          ? t("vaultHealth.weakFavorites.noDomain", "No domain match — rename the issuer to its brand for cleaner recovery.")
                          : t("vaultHealth.weakFavorites.noIcon", "Domain matched but no brand logo — the row will show initials.")}
                      </div>
                    </div>
                  </div>
                ))}
              </Category>

              {/* Missing icons */}
              <Category
                icon={<ImageIcon className="h-3.5 w-3.5" strokeWidth={2} />}
                title={t("vaultHealth.missingIcons.title", "Missing icons")}
                emptyText={t("vaultHealth.missingIcons.empty", "Every account has a brand logo.")}
                count={report.missingIcons.length}
                severity="info"
              >
                {report.missingIcons.map((m) => (
                  <div
                    key={m.accountId}
                    className="flex items-center gap-3 rounded-[12px] px-3 py-2"
                    style={{
                      background: CREAM,
                      border: `1px solid ${BORDER}`,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]" style={{ color: CHARCOAL }}>
                        <span style={{ fontWeight: 600 }}>{m.issuer || t("vaultHealth.issuer.unknown", "Unknown")}</span>
                        {m.label && (
                          <span style={{ color: MUTED }}> · {m.label}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </Category>

              {/* HIBP — opt-in per issuer */}
              <Category
                icon={<ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />}
                title={t("vaultHealth.hibp.title", "Breach check (optional)")}
                emptyText={t("vaultHealth.hibp.empty", "No issuers to check.")}
                count={-1 /* always render body */}
                severity="info"
              >
                {!canBreachScan ? (
                  <BreachUpgradeCard />
                ) : (
                  <>
                <div className="text-[11.5px]" style={{ color: MUTED }}>
                  {t("vaultHealth.hibp.explanation", "Tap an issuer to run an anonymous k-anonymity lookup against Have I Been Pwned. Only the first 5 characters of the hashed domain are sent — the issuer name and full hash stay on this device.")}
                </div>

                <div className="space-y-1.5">
                  {uniqueIssuers(report).map((issuer) => {
                    const r = hibp[issuer];
                    return (
                      <div
                        key={issuer}
                        className="flex items-center justify-between gap-3 rounded-[12px] px-3 py-2"
                        style={{
                          background: CREAM,
                          border: `1px solid ${BORDER}`,
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px]" style={{ color: CHARCOAL, fontWeight: 600 }}>
                            {issuer}
                          </div>
                          <div className="text-[11.5px]" style={{ color: MUTED }}>
                            {r === "loading"
                              ? t("vaultHealth.hibp.checking", "Checking…")
                              : r?.status === "match"
                                ? t("vaultHealth.hibp.match", "Prefix match ({count} hits). Coarse signal only.", { count: r.count })
                                : r?.status === "clean"
                                  ? t("vaultHealth.hibp.clean", "No prefix match in HIBP corpus.")
                                  : r?.status === "skipped"
                                    ? r.reason
                                    : r?.status === "error"
                                      ? r.message
                                      : t("vaultHealth.hibp.idle", "Not checked yet.")}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void runHibp(issuer)}
                          disabled={r === "loading"}
                          className="shrink-0 rounded-[6px] px-3 py-1.5 text-[13px] disabled:opacity-50"
                          style={{
                            background: "transparent",
                            border: `1px solid rgb(var(--aegis-ink-rgb) / 0.4)`,
                            color: CHARCOAL,
                            fontWeight: 400,
                          }}
                        >
                          {r === "loading" ? "…" : r ? t("vaultHealth.hibp.button.recheck", "Recheck") : t("vaultHealth.hibp.button.check", "Check")}
                        </button>

                      </div>
                    );
                  })}
                </div>
                  </>
                )}
              </Category>


              <div
                className="pt-1 text-center text-[10.5px]"
                style={{ color: MUTED, letterSpacing: "0.02em" }}
              >
                {t("vaultHealth.scannedAt", "Scanned {time}", { time: new Date(report.scannedAt).toLocaleTimeString() })}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function Category({
  icon,
  title,
  emptyText,
  count,
  severity,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  emptyText: string;
  /** -1 = always render children even when empty. */
  count: number;
  severity: "warn" | "info";
  children: React.ReactNode;
}) {
  const isEmpty = count === 0;
  return (
    <section aria-label={title} className="space-y-2">
      <header className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10.5px] uppercase"
          style={{
            background: CREAM,
            color: severity === "warn" ? DANGER : MUTED,
            border: `1px solid ${BORDER}`,
            letterSpacing: "0.16em",
            fontWeight: 600,
          }}
        >
          {isEmpty ? (
            <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
          ) : severity === "warn" ? (
            <AlertTriangle className="h-3 w-3" strokeWidth={2} />
          ) : (
            icon
          )}
          {title}
        </span>
        {count >= 0 && (
          <span className="text-[12px]" style={{ color: MUTED }}>
            {count === 0 ? "0" : count}
          </span>
        )}
      </header>

      {isEmpty ? (
        <div
          className="rounded-[12px] px-3 py-2.5 text-[12px]"
          style={{
            background: CREAM,
            border: `1px solid ${BORDER}`,
            color: MUTED,
          }}
        >
          {emptyText}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function uniqueIssuers(report: VaultHealthReport): string[] {
  const set = new Set<string>();
  for (const w of report.weakFavorites) if (w.issuer) set.add(w.issuer);
  for (const m of report.missingIcons) if (m.issuer) set.add(m.issuer);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
