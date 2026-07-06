import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, Monitor, Smartphone, Tablet, LogOut, RefreshCw } from "lucide-react";

import { BORDER, CHARCOAL, CREAM_SOFT, MUTED, Notice } from "@/components/aegis/chrome";
import { SectionLabel, SettingsGroup } from "@/components/aegis/settings";
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
 * Inline devices list — designed to slot into the Security settings screen
 * as a native SettingsGroup section instead of living on a separate route.
 * Matches the Aegis chrome (cream/charcoal, hairline dividers, pill actions).
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<DeviceRow | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const rows = await listFn();
      setDevices(rows);
      setLoadError(null);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not load devices.";
      setLoadError(text);
      if (silent) toast.error(text);
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

  return (
    <>
      <div className="flex items-end justify-between">
        <SectionLabel>
          {heading}
          {count > 0 && (
            <span
              className="ml-2 rounded-full px-1.5 py-[1px] text-[9px]"
              style={{
                background: "rgb(var(--aegis-ink-rgb) / 0.06)",
                color: MUTED,
                border: `1px solid ${BORDER}`,
                letterSpacing: "0.14em",
                fontWeight: 600,
              }}
            >
              {count}
            </span>
          )}
        </SectionLabel>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading || refreshing}
          className="mb-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] uppercase disabled:opacity-50"
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

      {loading && (
        <div
          className="flex items-center justify-center rounded-[16px] px-4 py-8"
          style={{ background: CREAM_SOFT, border: `1px solid ${BORDER}` }}
        >
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} />
        </div>
      )}

      {!loading && loadError && (
        <Notice kind="error">{loadError}</Notice>
      )}

      {!loading && !loadError && devices && devices.length === 0 && (
        <div
          className="rounded-[16px] px-4 py-6 text-center text-[13px]"
          style={{
            background: CREAM_SOFT,
            border: `1px solid ${BORDER}`,
            color: MUTED,
          }}
        >
          No devices recorded yet. Sign in from another device to see it here.
        </div>
      )}

      {!loading && devices && devices.length > 0 && (
        <SettingsGroup>
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
                  className="flex items-center gap-3 px-4 py-3"
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
                      className="mt-0.5 truncate text-[12.5px] leading-[1.4]"
                      style={{ color: MUTED }}
                    >
                      {formatLocation(d.coarse_country, d.coarse_region)} · Active{" "}
                      {formatWhen(d.last_seen_at)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingRevoke(d)}
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
        </SettingsGroup>
      )}

      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !busyId) setPendingRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRevoke?.is_current
                ? "Sign out this device?"
                : `Revoke ${pendingRevoke?.device_label ?? "device"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {pendingRevoke?.is_current
                    ? "You'll be signed out immediately and sent back to the sign-in screen."
                    : "That device's session will be revoked. It will need to sign in again to see your codes."}
                </p>
                {pendingRevoke && (
                  <div
                    className="rounded-lg border p-3 text-left text-[12.5px]"
                    style={{ borderColor: BORDER, background: CREAM_SOFT, color: CHARCOAL }}
                  >
                    <div style={{ fontWeight: 600 }}>{pendingRevoke.device_label}</div>
                    <div className="mt-0.5" style={{ color: MUTED }}>
                      {formatLocation(
                        pendingRevoke.coarse_country,
                        pendingRevoke.coarse_region,
                      )}
                    </div>
                    <div style={{ color: MUTED }}>
                      Last active {formatWhen(pendingRevoke.last_seen_at)}
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
                "Sign out"
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
