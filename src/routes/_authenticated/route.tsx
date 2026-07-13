import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { initAutoLockForUser, useActivityKeepAlive } from "@/lib/vault-session";
import { initHideCodesForUser } from "@/lib/vault-privacy";
import { recordDeviceSeen } from "@/lib/devices.functions";
import { requestPersistentStorage } from "@/lib/storage-quota";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Offline-safe: read the persisted session from localStorage first so
    // Profile / Security / Add pages stay reachable without network. Only
    // try the network-validated getUser() when we're online; on any network
    // failure, fall back to the cached session user rather than bouncing
    // to /auth (which would blank the app the moment Wi-Fi drops).
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user ?? null;
    if (!sessionUser) {
      throw redirect({ to: "/auth" });
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { user: sessionUser };
    }
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        // Network reachable but token rejected → real sign-out.
        if (error && /network|failed to fetch|timeout/i.test(error.message)) {
          return { user: sessionUser };
        }
        throw redirect({ to: "/auth" });
      }
      return { user: data.user };
    } catch (err) {
      // Fetch threw (offline mid-flight, DNS, etc.) — keep the user in.
      if (err && typeof err === "object" && "to" in err) throw err;
      return { user: sessionUser };
    }
  },
  component: AuthenticatedShell,
});

function AuthenticatedShell() {
  const { user } = Route.useRouteContext();
  useActivityKeepAlive();
  const heartbeat = useServerFn(recordDeviceSeen);
  useEffect(() => {
    initAutoLockForUser(user.id);
    initHideCodesForUser(user.id);
    // Ask the browser to mark our IndexedDB persistent as early as
    // possible — before the user ever visits /vault. Idempotent, safe
    // to call on every mount.
    void requestPersistentStorage().catch(() => {});
    // Phase 9.1: record this device session so it shows up in Security → Devices.
    void heartbeat().catch(() => {
      // Non-fatal; the vault still works if this fails (e.g. offline).
    });
  }, [user.id, heartbeat]);
  return <Outlet />;
}
