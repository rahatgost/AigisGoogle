import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { initAutoLockForUser, useActivityKeepAlive } from "@/lib/vault-session";
import { initHideCodesForUser } from "@/lib/vault-privacy";
import { recordDeviceSeen } from "@/lib/devices.functions";
import { requestPersistentStorage } from "@/lib/storage-quota";
import { getOrCreateGuestId, isGuestId } from "@/lib/guest-user";

function synthesizeGuestUser(): User {
  const id = getOrCreateGuestId();
  return {
    id,
    email: undefined,
    app_metadata: { provider: "guest" },
    user_metadata: { is_guest: true },
    aud: "guest",
    created_at: new Date(0).toISOString(),
  } as unknown as User;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Local-only guest mode: if there is no Supabase session, synthesize
    // a stable guest user so the whole app works offline. Cloud-only
    // features gate themselves via `isGuestId(user.id)`.
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user ?? null;
    if (!sessionUser) {
      return { user: synthesizeGuestUser() };
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { user: sessionUser };
    }
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        // Token rejected but we have a locally cached session — keep the
        // user in offline-tolerant mode rather than blanking the app.
        return { user: sessionUser };
      }
      return { user: data.user };
    } catch {
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
    // Guest users have no server-side row, so skip the heartbeat.
    if (!isGuestId(user.id)) {
      void heartbeat().catch(() => {
        // Non-fatal; the vault still works if this fails (e.g. offline).
      });
    }
  }, [user.id, heartbeat]);
  return <Outlet />;
}
