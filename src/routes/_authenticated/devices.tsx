import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2, Monitor, Trash2 } from "lucide-react";

import {
  BORDER,
  CHARCOAL,
  CREAM,
  CREAM_SOFT,
  MUTED,
  Notice,
} from "@/components/aegis/chrome";
import { LargeTitle, SectionLabel, SettingsGroup } from "@/components/aegis/settings";
import {
  listMyDevices,
  revokeDeviceSession,
  type DeviceRow,
} from "@/lib/devices.functions";

export const Route = createFileRoute("/_authenticated/devices")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Devices — Aegis" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Devices currently signed into your Aegis vault. Sign out any of them.",
      },
    ],
  }),
  component: DevicesPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

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

function DevicesPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(listMyDevices);
  const revokeFn = useServerFn(revokeDeviceSession);

  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await listFn();
      setDevices(rows);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not load devices.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revoke = async (row: DeviceRow) => {
    const label = row.is_current ? "this device" : row.device_label;
    const ok = window.confirm(
      row.is_current
        ? `Sign this device out?\n\nYou'll be sent back to the sign-in screen.`
        : `Sign out ${label}?\n\nThat device will need to sign in again to see your codes.`,
    );
    if (!ok) return;
    setBusyId(row.session_id);
    setNotice(null);
    try {
      await revokeFn({ data: { sessionId: row.session_id } });
      if (row.is_current) {
        // Force a hard reload — the current refresh token is now dead.
        window.location.replace("/auth");
        return;
      }
      setDevices((prev) => (prev ? prev.filter((d) => d.session_id !== row.session_id) : prev));
      setNotice({ kind: "info", text: `Signed out ${label}.` });
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not sign out that device.",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: CREAM,
        color: CHARCOAL,
        fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div className="mx-auto flex max-w-xl flex-col px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => navigate({ to: "/security" })}
          className="mb-2 inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-[13px]"
          style={{ color: MUTED }}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          Back to Security
        </button>

        <LargeTitle
          title="Devices"
          subtitle="Every device currently signed into your vault. Sign out any you don't recognize."
        />

        <div className="flex flex-col gap-1 pt-1">
          <SectionLabel>Signed in</SectionLabel>

          {loading && (
            <div
              className="flex items-center justify-center rounded-[16px] px-4 py-8"
              style={{ background: CREAM_SOFT, border: `1px solid ${BORDER}` }}
            >
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} />
            </div>
          )}

          {!loading && devices && devices.length === 0 && (
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
                {devices.map((d) => (
                  <motion.div
                    key={d.session_id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-start gap-3 px-4 py-3.5"
                    style={{ borderBottom: `1px solid ${BORDER}` }}
                  >
                    <div
                      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: d.is_current ? CHARCOAL : "rgba(0,0,0,0.05)",
                        color: d.is_current ? CREAM_SOFT : CHARCOAL,
                      }}
                    >
                      <Monitor className="h-4 w-4" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className="flex items-center gap-2 text-[14px]"
                        style={{ color: CHARCOAL, fontWeight: 600 }}
                      >
                        <span className="truncate">{d.device_label}</span>
                        {d.is_current && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px]"
                            style={{
                              background: CHARCOAL,
                              color: CREAM_SOFT,
                              letterSpacing: "0.06em",
                            }}
                          >
                            THIS DEVICE
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
                        {formatLocation(d.coarse_country, d.coarse_region)} · Last active{" "}
                        {formatWhen(d.last_seen_at)}
                      </div>
                      <div className="mt-0.5 text-[11.5px]" style={{ color: MUTED }}>
                        First seen {formatWhen(d.first_seen_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revoke(d)}
                      disabled={busyId === d.session_id}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px]"
                      style={{
                        border: `1px solid ${BORDER}`,
                        color: CHARCOAL,
                        background: CREAM_SOFT,
                        opacity: busyId === d.session_id ? 0.6 : 1,
                      }}
                      aria-label={`Sign out ${d.device_label}`}
                    >
                      {busyId === d.session_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                      )}
                      Sign out
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </SettingsGroup>
          )}

          {notice && (
            <div className="pt-3">
              <Notice kind={notice.kind}>{notice.text}</Notice>
            </div>
          )}

          <p
            className="pt-6 text-center text-[11px]"
            style={{ color: MUTED, letterSpacing: "0.02em" }}
          >
            Signing a device out revokes its refresh token immediately.
          </p>
        </div>
      </div>
    </div>
  );
}
