import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { History, Monitor, RefreshCw, Smartphone, Tablet, X } from "lucide-react";
import { useLingui } from "@lingui/react";

import { BORDER, CHARCOAL, CREAM_SOFT, MUTED, soft } from "@/components/aegis/chrome";
import { SettingsGroup, SettingsRow } from "@/components/aegis/settings";
import { listMyLoginEvents, type LoginEventRow } from "@/lib/devices.functions";

/**
 * Phase 9.2 — Sign-in history.
 */

function useT() {
  const { i18n } = useLingui();
  return (id: string, fallback: string, values?: Record<string, unknown>) => {
    const msg = i18n._(id, values);
    return msg === id ? fallback : msg;
  };
}

function useFormatWhen() {
  const t = useT();
  return (iso: string): string => {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const min = Math.round(diffMs / 60_000);
    if (min < 1) return t("relTime.justNow", "just now");
    if (min < 60) return t("relTime.minutes", "{count}m ago", { count: min });
    const hr = Math.round(min / 60);
    if (hr < 24) return t("relTime.hours", "{count}h ago", { count: hr });
    const days = Math.round(hr / 24);
    if (days < 30) return t("relTime.days", "{count}d ago", { count: days });
    return d.toLocaleDateString();
  };
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function deviceIcon(label: string) {
  const l = (label || "").toLowerCase();
  if (l.includes("iphone") || l.includes("android")) return Smartphone;
  if (l.includes("ipad") || l.includes("tablet")) return Tablet;
  return Monitor;
}

export function SignInHistorySection({ heading }: { heading?: string }) {
  const t = useT();
  const formatWhen = useFormatWhen();
  const listFn = useServerFn(listMyLoginEvents);
  const [events, setEvents] = useState<LoginEventRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [politeMsg, setPoliteMsg] = useState("");
  const [assertiveMsg, setAssertiveMsg] = useState("");

  const resolvedHeading = heading ?? t("signInHistory.heading", "Sign-in history");

  const announce = (text: string, tone: "polite" | "assertive" = "polite") => {
    if (tone === "assertive") {
      setAssertiveMsg("");
      window.setTimeout(() => setAssertiveMsg(text), 50);
    } else {
      setPoliteMsg("");
      window.setTimeout(() => setPoliteMsg(text), 50);
    }
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const rows = await listFn();
      setEvents(rows);
      setErrorMsg(null);
      if (silent) {
        announce(
          rows.length === 0
            ? t("signInHistory.announce.emptyRefresh", "Sign-in history refreshed. No sign-ins recorded yet.")
            : rows.length === 1
              ? t("signInHistory.announce.refresh.one", "Sign-in history refreshed. {count} recent sign-in.", { count: rows.length })
              : t("signInHistory.announce.refresh.other", "Sign-in history refreshed. {count} recent sign-ins.", { count: rows.length }),
        );
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : t("signInHistory.error.load", "Could not load sign-in history.");
      setErrorMsg(text);
      toast.error(t("signInHistory.error.title", "Couldn't load sign-in history"), { description: text });
      announce(t("signInHistory.announce.error", "Couldn't load sign-in history. {text}", { text }), "assertive");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const count = events?.length ?? 0;
  const latest = events?.[0] ?? null;
  const summary = loading
    ? t("signInHistory.loading", "Loading…")
    : errorMsg
      ? t("signInHistory.error.title", "Couldn't load sign-in history")
      : count === 0
        ? t("signInHistory.empty", "No sign-ins recorded yet")
        : latest
          ? t("signInHistory.summary.latest", "Last sign-in {when} · {device}", { when: formatWhen(latest.event_at), device: latest.device_label })
          : count === 1
            ? t("signInHistory.summary.count.one", "{count} recent sign-in", { count })
            : t("signInHistory.summary.count.other", "{count} recent sign-ins", { count });

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
          icon={<History className="h-4 w-4" strokeWidth={1.8} />}
          title={resolvedHeading}
          description={summary}
          onClick={() => setSheetOpen(true)}
          chevron
          badge={count > 0 ? String(count) : undefined}
        />
      </SettingsGroup>

      <AnimatePresence>
        {sheetOpen && (
          <HistorySheet
            events={events}
            loading={loading}
            refreshing={refreshing}
            errorMsg={errorMsg}
            onRefresh={() => void load(true)}
            onClose={() => setSheetOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}


function HistorySheet({
  events,
  loading,
  refreshing,
  errorMsg,
  onRefresh,
  onClose,
}: {
  events: LoginEventRow[] | null;
  loading: boolean;
  refreshing: boolean;
  errorMsg: string | null;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const formatWhen = useFormatWhen();
  const titleId = useId();
  const descId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const tm = window.setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(tm);
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

  const count = events?.length ?? 0;

  const formatLocation = (country: string | null, region: string | null): string => {
    const parts = [region, country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : t("signInHistory.locationUnknown", "Location unknown");
  };

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
        className="relative z-10 mx-auto flex max-h-[85vh] w-full max-w-[440px] flex-col rounded-t-[22px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[22px] focus:outline-none"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-[4px] w-10 shrink-0 rounded-full"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.22)" }}
        />

        <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[18px]"
              style={{
                fontFamily: "'Playfair Display', serif",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: CHARCOAL,
              }}
            >
              {t("signInHistory.title", "Sign-in history")}
            </h2>
            <div id={descId} className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
              {t("signInHistory.subtitle", "The last 20 successful sign-ins to your Aegis account. Kept for 90 days.")}
            </div>
          </div>
          <motion.button
            ref={closeBtnRef}
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label={t("signInHistory.closeAria", "Close sign-in history")}
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </motion.button>
        </div>

        <div className="mb-3 flex shrink-0 items-center justify-between">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] uppercase"
            style={{
              background: "rgb(var(--aegis-ink-rgb) / 0.05)",
              color: MUTED,
              border: `1px solid ${BORDER}`,
              letterSpacing: "0.14em",
              fontWeight: 600,
            }}
          >
            <History className="h-3 w-3" strokeWidth={2} />
            {loading ? t("signInHistory.loadingShort", "Loading") : t("signInHistory.recentCount", "{count} recent", { count })}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] uppercase disabled:opacity-50"
            style={{ color: MUTED, letterSpacing: "0.12em", fontWeight: 600 }}
            aria-label={t("signInHistory.refreshAria", "Refresh sign-in history")}
          >
            <RefreshCw
              className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
              strokeWidth={2}
            />
            {t("signInHistory.refresh", "Refresh")}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-1" aria-busy={loading}>
          {loading && (
            <ol className="space-y-2" aria-label={t("signInHistory.loadingAria", "Loading sign-in history")}>
              {[0, 1, 2, 3].map((i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-[14px] px-3 py-3"
                  style={{
                    background: "rgb(var(--aegis-ink-rgb) / 0.025)",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  <div
                    className="h-9 w-9 shrink-0 animate-pulse rounded-full"
                    style={{ background: "rgb(var(--aegis-ink-rgb) / 0.08)" }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div
                      className="h-3 w-2/5 animate-pulse rounded-full"
                      style={{ background: "rgb(var(--aegis-ink-rgb) / 0.09)" }}
                      aria-hidden
                    />
                    <div
                      className="h-2.5 w-3/5 animate-pulse rounded-full"
                      style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)" }}
                      aria-hidden
                    />
                    <div
                      className="h-2.5 w-1/3 animate-pulse rounded-full"
                      style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)" }}
                      aria-hidden
                    />
                  </div>
                </li>
              ))}
              <span className="sr-only">{t("signInHistory.loadingSr", "Loading sign-in history…")}</span>
            </ol>
          )}

          {!loading && errorMsg && (
            <div
              role="alert"
              className="rounded-[16px] px-4 py-6 text-center text-[13px]"
              style={{
                background: "rgb(var(--aegis-ink-rgb) / 0.03)",
                border: `1px solid ${BORDER}`,
                color: CHARCOAL,
              }}
            >
              <div style={{ fontWeight: 600 }}>{t("signInHistory.error.title", "Couldn't load sign-in history")}</div>
              <div className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
                {errorMsg}
              </div>
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] uppercase disabled:opacity-50"
                style={{
                  background: CHARCOAL,
                  color: CREAM_SOFT,
                  letterSpacing: "0.12em",
                  fontWeight: 600,
                }}
              >
                <RefreshCw
                  className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
                  strokeWidth={2}
                />
                {t("common.retry", "Try again")}
              </button>
            </div>
          )}

          {!loading && !errorMsg && events && events.length === 0 && (
            <div
              className="flex flex-col items-center gap-3 rounded-[16px] px-4 py-10 text-center"
              style={{
                background: "rgb(var(--aegis-ink-rgb) / 0.03)",
                border: `1px solid ${BORDER}`,
              }}
            >
              <div
                className="flex h-11 w-11 items-center justify-center rounded-full"
                style={{ background: "rgb(var(--aegis-ink-rgb) / 0.08)", color: CHARCOAL }}
                aria-hidden
              >
                <History className="h-5 w-5" strokeWidth={1.7} />
              </div>
              <div>
                <div className="text-[13.5px]" style={{ color: CHARCOAL, fontWeight: 600 }}>
                  {t("signInHistory.empty", "No sign-ins recorded yet")}
                </div>
                <div className="mt-1 text-[12px]" style={{ color: MUTED }}>
                  {t("signInHistory.empty.body", "New sign-ins will appear here for 90 days.")}
                </div>
              </div>
            </div>
          )}


          {!loading && events && events.length > 0 && (
            <ol className="space-y-2">
              {events.map((ev) => {
                const Icon = deviceIcon(ev.device_label);
                return (
                  <li
                    key={ev.id}
                    className="flex items-start gap-3 rounded-[14px] px-3 py-3"
                    style={{
                      background: "rgb(var(--aegis-ink-rgb) / 0.025)",
                      border: `1px solid ${BORDER}`,
                    }}
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ background: CHARCOAL, color: CREAM_SOFT }}
                      aria-hidden
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-[13.5px]"
                        style={{ color: CHARCOAL, fontWeight: 600 }}
                      >
                        {ev.device_label || t("signInHistory.unknownDevice", "Unknown device")}
                      </div>
                      <div
                        className="mt-0.5 truncate text-[12px]"
                        style={{ color: MUTED }}
                      >
                        {formatLocation(ev.coarse_country, ev.coarse_region)}
                      </div>
                      <div
                        className="mt-0.5 text-[11.5px]"
                        style={{ color: MUTED }}
                        title={formatDateTime(ev.event_at)}
                      >
                        {formatWhen(ev.event_at)} · {formatDateTime(ev.event_at)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
