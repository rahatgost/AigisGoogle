import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  Loader2,
  Monitor,
  Smartphone,
  Tablet,
  LogOut,
  RefreshCw,
  X,
  ShieldCheck,
} from "lucide-react";
import { useLingui } from "@lingui/react";

import { BORDER, CHARCOAL, CREAM_SOFT, MUTED, soft } from "@/components/aegis/chrome";
import { SettingsGroup, SettingsRow } from "@/components/aegis/settings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listMyDevices,
  revokeDeviceSession,
  type DeviceRow,
} from "@/lib/devices.functions";

/**
 * Compact "Devices" summary row that opens a full-list bottom sheet.
 * The sheet is where users review every signed-in session and revoke
 * others — each revoke goes through an AlertDialog with explicit copy
 * so the outcome is unambiguous.
 */

function useT() {
  const { i18n } = useLingui();
  return (id: string, fallback: string, values?: Record<string, unknown>) => {
    const msg = values ? i18n._(id, values) : i18n._(id);
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

function useFormatLocation() {
  const t = useT();
  return (country: string | null, region: string | null): string => {
    const parts = [region, country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : t("devices.locationUnknown", "Location unknown");
  };
}

function deviceIcon(label: string) {
  const l = (label || "").toLowerCase();
  if (l.includes("iphone") || l.includes("android")) return Smartphone;
  if (l.includes("ipad") || l.includes("tablet")) return Tablet;
  return Monitor;
}

export function DevicesSection({ heading }: { heading?: string }) {
  const t = useT();
  const formatWhen = useFormatWhen();
  const formatLocation = useFormatLocation();
  const listFn = useServerFn(listMyDevices);
  const revokeFn = useServerFn(revokeDeviceSession);

  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<DeviceRow | null>(null);
  const [politeMsg, setPoliteMsg] = useState("");
  const [assertiveMsg, setAssertiveMsg] = useState("");

  const resolvedHeading = heading ?? t("devices.section", "Devices");

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
      setDevices(rows);
    } catch (err) {
      const text = err instanceof Error ? err.message : t("devices.error.load", "Could not load devices.");
      toast.error(t("devices.error.loadTitle", "Couldn't load devices"), { description: text });
      announce(t("devices.announce.errorLoad", "Couldn't load devices. {text}", { text }), "assertive");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmRevoke = async () => {
    const row = pendingRevoke;
    if (!row) return;
    const label = row.is_current ? t("devices.thisDevice", "this device") : row.device_label;
    setBusyId(row.session_id);
    try {
      await revokeFn({ data: { sessionId: row.session_id } });
      if (row.is_current) {
        toast.success(t("devices.toast.signedOutRedirecting", "Signed out. Redirecting…"));
        announce(t("devices.announce.signedOutThisDevice", "Signed out of this device. Redirecting to sign in."), "assertive");
        setPendingRevoke(null);
        window.location.replace("/auth");
        return;
      }
      setDevices((prev) => (prev ? prev.filter((d) => d.session_id !== row.session_id) : prev));
      const location = formatLocation(row.coarse_country, row.coarse_region);
      const when = formatWhen(row.last_seen_at);
      toast.success(t("devices.toast.signedOutDevice", "Signed out {label}", { label }), {
        description: t("devices.toast.signedOutDeviceDetail", "{location} · Last active {when}", { location, when }),
      });
      announce(
        t("devices.announce.signedOutDevice", "{label} in {location} was signed out successfully. Last active {when}.", { label, location, when }),
      );
      setPendingRevoke(null);
    } catch (err) {
      const reason = err instanceof Error ? err.message : t("devices.error.revokeRetry", "Please try again.");
      toast.error(t("devices.error.revoke", "Couldn't sign that device out"), { description: reason });
      announce(t("devices.error.revokeDetail", "Couldn't sign {label} out. {reason}", { label, reason }), "assertive");
    } finally {
      setBusyId(null);
    }
  };

  const count = devices?.length ?? 0;
  const current = devices?.find((d) => d.is_current) ?? null;
  const summary = loading
    ? t("devices.loading", "Loading…")
    : count === 0
      ? t("devices.empty", "No devices recorded yet")
      : current
        ? (count === 1
          ? t("devices.summary.withCurrent.one", "{count} signed in · This device: {label}", { count, label: current.device_label })
          : t("devices.summary.withCurrent.other", "{count} signed in · This device: {label}", { count, label: current.device_label }))
        : (count === 1
          ? t("devices.summary.count.one", "{count} signed in", { count })
          : t("devices.summary.count.other", "{count} signed in", { count }));

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {politeMsg}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertiveMsg}
      </div>

      <SettingsGroup>
        <SettingsRow
          icon={<Monitor className="h-4 w-4" strokeWidth={1.8} />}
          title={resolvedHeading}
          description={summary}
          onClick={() => setSheetOpen(true)}
          chevron
          badge={count > 0 ? String(count) : undefined}
        />
      </SettingsGroup>

      <AnimatePresence>
        {sheetOpen && (
          <DevicesSheet
            devices={devices}
            loading={loading}
            refreshing={refreshing}
            busyId={busyId}
            onRefresh={() => void load(true)}
            onRevoke={(row) => setPendingRevoke(row)}
            onClose={() => setSheetOpen(false)}
          />
        )}
      </AnimatePresence>

      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !busyId) setPendingRevoke(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRevoke?.is_current
                ? t("devices.dialog.signOutThisTitle", "Sign out this device?")
                : t("devices.dialog.revokeTitle", "Revoke {label}?", { label: pendingRevoke?.device_label ?? t("devices.thisDevice", "this device") })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                <p className="text-[13.5px] leading-[1.55]">
                  {pendingRevoke?.is_current
                    ? t("devices.dialog.signOutThisDesc", "You'll be signed out of Aegis on this device right now and returned to the sign-in screen.")
                    : t("devices.dialog.revokeDesc", "This ends the session on that device immediately.")}
                </p>
                <ul
                  className="space-y-1.5 text-[12.5px] leading-[1.5]"
                  style={{ color: MUTED }}
                >
                  <li className="flex gap-2">
                    <span aria-hidden>·</span>
                    <span>
                      {t("devices.dialog.bullet.refresh", "The device is signed out and its refresh token is invalidated. It will need to sign in with your email again to see any codes.")}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden>·</span>
                    <span>
                      {t("devices.dialog.bullet.vault", "Your encrypted vault is untouched. Codes on your other devices keep working.")}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden>·</span>
                    <span>{t("devices.dialog.bullet.audit", "This action is recorded in your account's audit log.")}</span>
                  </li>
                </ul>

                {pendingRevoke && (
                  <div
                    className="rounded-xl border p-3 text-[12.5px]"
                    style={{ borderColor: BORDER, background: CREAM_SOFT, color: CHARCOAL }}
                  >
                    <div style={{ fontWeight: 600 }}>{pendingRevoke.device_label}</div>
                    <div className="mt-1 space-y-0.5" style={{ color: MUTED }}>
                      <div>
                        {formatLocation(
                          pendingRevoke.coarse_country,
                          pendingRevoke.coarse_region,
                        )}
                      </div>
                      <div>{t("devices.dialog.lastActive", "Last active {when}", { when: formatWhen(pendingRevoke.last_seen_at) })}</div>
                      <div>{t("devices.dialog.firstSignedIn", "First signed in {when}", { when: formatDateTime(pendingRevoke.first_seen_at) })}</div>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>{t("devices.dialog.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRevoke();
              }}
              disabled={busyId !== null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busyId ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {t("devices.dialog.signingOut", "Signing out…")}
                </>
              ) : pendingRevoke?.is_current ? (
                t("devices.dialog.signOutBtn", "Sign out this device")
              ) : (
                t("devices.dialog.revokeBtn", "Revoke device")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DevicesSheet({
  devices,
  loading,
  refreshing,
  busyId,
  onRefresh,
  onRevoke,
  onClose,
}: {
  devices: DeviceRow[] | null;
  loading: boolean;
  refreshing: boolean;
  busyId: string | null;
  onRefresh: () => void;
  onRevoke: (row: DeviceRow) => void;
  onClose: () => void;
}) {
  const t = useT();
  const formatWhen = useFormatWhen();
  const formatLocation = useFormatLocation();
  const count = devices?.length ?? 0;
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
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: CHARCOAL,
              }}
            >
              {t("devices.sheet.title", "Signed-in devices")}
            </h2>
            <div id={descId} className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
              {t("devices.sheet.subtitle", "Every device with an active Aegis session. Sign out any that aren't yours.")}
            </div>
          </div>
          <motion.button
            ref={closeBtnRef}
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label={t("devices.sheet.closeAria", "Close signed-in devices")}
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
            <ShieldCheck className="h-3 w-3" strokeWidth={2} />
            {loading ? t("devices.sheet.loading", "Loading") : (count === 1 ? t("devices.sheet.activeCount.one", "{count} active", { count }) : t("devices.sheet.activeCount.other", "{count} active", { count }))}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] uppercase disabled:opacity-50"
            style={{ color: MUTED, letterSpacing: "0.12em", fontWeight: 600 }}
            aria-label={t("devices.sheet.refreshAria", "Refresh devices")}
          >
            <RefreshCw
              className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
              strokeWidth={2}
            />
            {t("devices.sheet.refresh", "Refresh")}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-1">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: MUTED }} />
            </div>
          )}

          {!loading && devices && devices.length === 0 && (
            <div
              className="rounded-[16px] px-4 py-8 text-center text-[13px]"
              style={{
                background: "rgb(var(--aegis-ink-rgb) / 0.03)",
                border: `1px solid ${BORDER}`,
                color: MUTED,
              }}
            >
              {t("devices.sheet.empty", "No devices recorded yet. Sign in from another device to see it here.")}
            </div>
          )}

          {!loading && devices && devices.length > 0 && (
            <div className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {devices.map((d) => {
                  const Icon = deviceIcon(d.device_label);
                  const busy = busyId === d.session_id;
                  return (
                    <motion.div
                      key={d.session_id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="flex items-center gap-3 rounded-[16px] px-4 py-3.5"
                      style={{
                        background: d.is_current
                          ? "rgb(var(--aegis-ink-rgb) / 0.04)"
                          : "rgb(var(--aegis-ink-rgb) / 0.02)",
                        border: `1px solid ${BORDER}`,
                      }}
                    >
                      <span
                        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                        style={{
                          background: d.is_current
                            ? CHARCOAL
                            : "rgb(var(--aegis-ink-rgb) / 0.05)",
                          color: d.is_current ? CREAM_SOFT : CHARCOAL,
                          border: `1px solid ${BORDER}`,
                        }}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.8} />
                        {d.is_current && (
                          <span
                            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full"
                            style={{
                              background: "#4ade80",
                              border: `2px solid ${CREAM_SOFT}`,
                            }}
                            aria-hidden
                          />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span
                            className="truncate text-[14.5px]"
                            style={{
                              color: CHARCOAL,
                              fontWeight: 500,
                              letterSpacing: "-0.005em",
                            }}
                          >
                            {d.device_label}
                          </span>
                          {d.is_current && (
                            <span
                              className="shrink-0 text-[10px] uppercase"
                              style={{
                                color: MUTED,
                                letterSpacing: "0.12em",
                                fontWeight: 600,
                              }}
                            >
                              {t("devices.sheet.thisDevice", "· This device")}
                            </span>
                          )}
                        </div>
                        <div
                          className="mt-0.5 truncate text-[12px] leading-[1.45]"
                          style={{ color: MUTED }}
                        >
                          {formatLocation(d.coarse_country, d.coarse_region)} · {t("devices.sheet.activeAt", "Active {when}", { when: formatWhen(d.last_seen_at) })}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRevoke(d)}
                        disabled={busy}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] transition-colors hover:opacity-80 disabled:opacity-50"
                        style={{
                          border: `1px solid ${BORDER}`,
                          color: CHARCOAL,
                          background: CREAM_SOFT,
                        }}
                        aria-label={
                          d.is_current
                            ? t("devices.sheet.signOutThisAria", "Sign out this device")
                            : t("devices.sheet.signOutDeviceAria", "Sign out {label}", { label: d.device_label })
                        }
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
                        )}
                        {d.is_current ? t("devices.sheet.signOutBtn", "Sign out") : t("devices.sheet.revokeBtn", "Revoke")}
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        <p
          className="mt-3 shrink-0 text-center text-[11px]"
          style={{ color: MUTED, letterSpacing: "0.02em" }}
        >
          {t("devices.sheet.locationDisclaimer", "Location is inferred from IP and never stored precisely.")}
        </p>
      </motion.div>
    </motion.div>
  );
}
