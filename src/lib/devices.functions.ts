import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Phase 9.1 — Trusted devices.
 *
 * `user_sessions_meta` is server-writable only. These functions run with
 * `requireSupabaseAuth` (so the caller is a real signed-in user) and use
 * the service-role admin client to touch the table.
 */

export interface DeviceRow {
  session_id: string;
  device_label: string;
  user_agent: string;
  coarse_country: string | null;
  coarse_region: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_current: boolean;
}

function parseDeviceLabel(ua: string): string {
  if (!ua) return "Unknown device";
  const s = ua;
  // OS
  let os = "";
  if (/Windows NT 10/i.test(s)) os = "Windows";
  else if (/Windows/i.test(s)) os = "Windows";
  else if (/iPhone|iPad|iOS/i.test(s)) os = /iPad/i.test(s) ? "iPad" : "iPhone";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "Mac";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Linux/i.test(s)) os = "Linux";
  else os = "Device";
  // Browser
  let browser = "";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = "Chrome";
  else if (/Firefox\//i.test(s)) browser = "Firefox";
  else if (/Safari\//i.test(s)) browser = "Safari";
  else browser = "Browser";
  return `${browser} on ${os}`;
}

function readCoarseGeo(): { country: string | null; region: string | null } {
  try {
    const req = getRequest();
    const h = req?.headers;
    if (!h) return { country: null, region: null };
    const country =
      h.get("cf-ipcountry") ??
      h.get("x-vercel-ip-country") ??
      h.get("x-country-code") ??
      null;
    const region =
      h.get("cf-region") ??
      h.get("x-vercel-ip-country-region") ??
      h.get("x-region") ??
      null;
    return { country: country || null, region: region || null };
  } catch {
    return { country: null, region: null };
  }
}

function readUserAgent(): string {
  try {
    return getRequest()?.headers.get("user-agent") ?? "";
  } catch {
    return "";
  }
}

/** Heartbeat: upsert this session's row and stamp last_seen_at. */
export const recordDeviceSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const claims = context.claims as { session_id?: string };
    const sessionId = claims?.session_id;
    if (!sessionId) return { ok: false as const, reason: "no_session_id" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ua = readUserAgent();
    const { country, region } = readCoarseGeo();
    const label = parseDeviceLabel(ua);

    // Upsert by session_id (primary key). Insert first-seen; if it exists,
    // just update last_seen_at (and refresh UA/geo in case they changed).
    const now = new Date().toISOString();

    // Try insert first (so the audit trigger fires only on true new sessions).
    const { error: insErr } = await supabaseAdmin
      .from("user_sessions_meta")
      .insert({
        session_id: sessionId,
        user_id: context.userId,
        user_agent: ua,
        device_label: label,
        coarse_country: country,
        coarse_region: region,
        first_seen_at: now,
        last_seen_at: now,
      });

    if (insErr && insErr.code !== "23505") {
      // Not a unique-violation — surface it.
      throw new Error(insErr.message);
    }
    if (insErr && insErr.code === "23505") {
      // Existing row — bump last_seen_at and refresh UA/geo.
      const { error: updErr } = await supabaseAdmin
        .from("user_sessions_meta")
        .update({
          last_seen_at: now,
          user_agent: ua,
          device_label: label,
          coarse_country: country,
          coarse_region: region,
        })
        .eq("session_id", sessionId)
        .eq("user_id", context.userId);
      if (updErr) throw new Error(updErr.message);
    } else {
      // Brand-new session on this device → record a sign-in event.
      // The audit trigger mirrors this into admin_audit for long-term retention.
      await supabaseAdmin.from("user_login_events").insert({
        user_id: context.userId,
        session_id: sessionId,
        device_label: label,
        user_agent: ua,
        coarse_country: country,
        coarse_region: region,
        event_at: now,
      });
      // Opportunistic 90-day trim. Cheap, indexed, best-effort.
      await supabaseAdmin.rpc("purge_old_login_events", { days: 90 });
    }

    return { ok: true as const };
  });

/**
 * Sign-in history — last N successful sign-ins for the current user.
 * Backed by `user_login_events`; 90-day rolling window enforced by
 * `purge_old_login_events`. RLS ensures the caller sees only their rows.
 */
export interface LoginEventRow {
  id: string;
  session_id: string | null;
  device_label: string;
  user_agent: string;
  coarse_country: string | null;
  coarse_region: string | null;
  event_at: string;
}

export const listMyLoginEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LoginEventRow[]> => {
    const { data, error } = await context.supabase
      .from("user_login_events")
      .select(
        "id, session_id, device_label, user_agent, coarse_country, coarse_region, event_at",
      )
      .eq("user_id", context.userId)
      .order("event_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      session_id: (r.session_id as string | null) ?? null,
      device_label: (r.device_label as string) ?? "",
      user_agent: (r.user_agent as string) ?? "",
      coarse_country: (r.coarse_country as string | null) ?? null,
      coarse_region: (r.coarse_region as string | null) ?? null,
      event_at: r.event_at as string,
    }));
  });

/** List devices the caller has signed in on, newest first. */
export const listMyDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeviceRow[]> => {
    const claims = context.claims as { session_id?: string };
    const currentSessionId = claims?.session_id ?? "";

    const { data, error } = await context.supabase
      .from("user_sessions_meta")
      .select(
        "session_id, device_label, user_agent, coarse_country, coarse_region, first_seen_at, last_seen_at",
      )
      .eq("user_id", context.userId)
      .order("last_seen_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      session_id: r.session_id as string,
      device_label: r.device_label as string,
      user_agent: r.user_agent as string,
      coarse_country: (r.coarse_country as string | null) ?? null,
      coarse_region: (r.coarse_region as string | null) ?? null,
      first_seen_at: r.first_seen_at as string,
      last_seen_at: r.last_seen_at as string,
      is_current: r.session_id === currentSessionId,
    }));
  });

/**
 * Revoke a device session: deletes the Supabase auth session (invalidating
 * its refresh token) and removes our meta row. Only allowed on sessions
 * owned by the caller.
 */
export const revokeDeviceSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ sessionId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ownership check — never let a user revoke someone else's session.
    const { data: row, error: selErr } = await supabaseAdmin
      .from("user_sessions_meta")
      .select("user_id")
      .eq("session_id", data.sessionId)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!row || row.user_id !== context.userId) {
      throw new Error("Not found");
    }

    // Delete the auth session via the Admin REST API. supabase-js does not
    // expose deleteSession(), but the endpoint is stable.
    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/sessions/${data.sessionId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(`Auth session revoke failed [${res.status}]: ${body}`);
    }

    // Remove the meta row (audit trigger records the deletion).
    const { error: delErr } = await supabaseAdmin
      .from("user_sessions_meta")
      .delete()
      .eq("session_id", data.sessionId)
      .eq("user_id", context.userId);
    if (delErr) throw new Error(delErr.message);

    return { ok: true as const };
  });
