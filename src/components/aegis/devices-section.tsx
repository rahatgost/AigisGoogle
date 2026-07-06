import { useEffect, useState } from "react";
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

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
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

function formatLocation(country: string | null, region: string | null): string {
  const parts = [region, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Location unknown";
}

function deviceIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes("iphone") || l.includes("android")) return Smartphone;
  if (l.includes("ipad") || l.includes("tablet")) return Tablet;
  return Monitor;
}

export function DevicesSection({ heading = "Devices" }: { heading?: string }) {
  const listFn = useServerFn(listMyDevices);
  const revokeFn = useServerFn(revokeDeviceSession);

  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<DeviceRow | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const rows = await listFn();
      setDevices(rows);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not load devices.";
      toast.error("Couldn't load devices", { description: text });
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
    const label = row.is_current ? "this device" : row.device_label;
    setBusyId(row.session_id);
    try {
      await revokeFn({ data: { sessionId: row.session_id } });
      if (row.is_current) {
        toast.success("Signed out. Redirecting…");
        setPendingRevoke(null);
        window.location.replace("/auth");
        return;
      }
      setDevices((prev) => (prev ? prev.filter((d) => d.session_id !== row.session_id) : prev));
      toast.success(`Signed out ${label}`, {
        description: `${formatLocation(row.coarse_country, row.coarse_region)} · Last active ${formatWhen(row.last_seen_at)}`,
      });
      setPendingRevoke(null);
    } catch (err) {
      toast.error("Couldn't sign that device out", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const count = devices?.length ?? 0;
  const current = devices?.find((d) => d.is_current) ?? null;
  const summary = loading
    ? "Loading…"
    : count === 0
      ? "No devices recorded yet"
      : current
        ? `${count} signed in · This device: ${current.device_label}`
        : `${count} signed in`;

  return (
    <>
      <SettingsGroup>
        <SettingsRow
          icon={<Monitor className="h-4 w-4" strokeWidth={1.8} />}
          title={heading}
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
                ? "Sign out this device?"
                : `Revoke ${pendingRevoke?.device_label ?? "this device"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                <p className="text-[13.5px] leading-[1.55]">
                  {pendingRevoke?.is_current
                    ? "You'll be signed out of Aegis on this device right now and returned to the sign-in screen."
                    : "This ends the session on that device immediately."}
                </p>
                <ul
                  className="space-y-1.5 text-[12.5px] leading-[1.5]"
                  style={{ color: MUTED }}
                >
                  <li className="flex gap-2">
                    <span aria-hidden>·</span>
                    <span>
                      The device is signed out and its refresh token is invalidated. It will
                      need to sign in with your email again to see any codes.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden>·</span>
                    <span>
                      Your encrypted vault is untouched. Codes on your other devices keep working.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden>·</span>
                    <span>This action is recorded in your account's audit log.</span>
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
                      <div>Last active {formatWhen(pendingRevoke.last_seen_at)}</div>
                      <div>First signed in {formatDateTime(pendingRevoke.first_seen_at)}</div>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>Cancel</AlertDialogCancel>
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
                  Signing out…
                </>
              ) : pendingRevoke?.is_current ? (
                "Sign out this device"
              ) : (
                "Revoke device"
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
  const count = devices?.length ?? 0;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label="Close"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{
          background: "rgb(var(--aegis-ink-rgb) / 0.35)",
          backdropFilter: "blur(4px)",
        }}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto flex max-h-[85vh] w-full max-w-[440px] flex-col rounded-t-[22px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-[4px] w-10 shrink-0 rounded-full"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.15)" }}
        />

        <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-[18px]"
              style={{
                fontFamily: "'Playfair Display', serif",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: CHARCOAL,
              }}
            >
              Signed-in devices
            </div>
            <div className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
              Every device with an active Aegis session. Sign out any that
              aren't yours.
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label="Close"
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
            {loading ? "Loading" : `${count} active`}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] uppercase disabled:opacity-50"
            style={{ color: MUTED, letterSpacing: "0.12em", fontWeight: 600 }}
            aria-label="Refresh devices"
          >
            <RefreshCw
              className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
              strokeWidth={2}
            />
            Refresh
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
              No devices recorded yet. Sign in from another device to see it
              here.
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
                              · This device
                            </span>
                          )}
                        </div>
                        <div
                          className="mt-0.5 truncate text-[12px] leading-[1.45]"
                          style={{ color: MUTED }}
                        >
                          {formatLocation(d.coarse_country, d.coarse_region)} ·
                          Active {formatWhen(d.last_seen_at)}
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
                            ? "Sign out this device"
                            : `Sign out ${d.device_label}`
                        }
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
                        )}
                        {d.is_current ? "Sign out" : "Revoke"}
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
          Location is inferred from IP and never stored precisely.
        </p>
      </motion.div>
    </motion.div>
  );
}
