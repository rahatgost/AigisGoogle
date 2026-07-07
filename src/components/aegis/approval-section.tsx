/**
 * "Cross-device approvals" section on the Security page (Phase 10.3 UI).
 *
 * Wires the previously-headless push infrastructure into a visible flow:
 *   - Enable / disable browser notifications on THIS device.
 *   - "Send test approval" button that calls `requestApproval` and shows
 *     an in-app confirmation link so E2E works even without a real
 *     WebPush arriving (helpful during development and iOS Safari where
 *     WebPush isn't installable).
 *
 * The nonce URL points at `/approve?nonce=…` — the same URL our WebPush
 * click handler opens — so tapping it here goes through the exact same
 * verification path.
 */

import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { BellRing, BellOff, Send, Loader2, ExternalLink, CheckCircle2 } from "lucide-react";

import { SectionLabel, SettingsGroup, SettingsRow } from "@/components/aegis/settings";
import { BORDER, CHARCOAL, MUTED } from "@/components/aegis/chrome";
import { Switch } from "@/components/ui/switch";
import { usePushSubscribe } from "@/lib/push-subscribe";
import { requestApproval } from "@/lib/push.functions";

interface PendingRequest {
  nonceId: string;
  expiresAt: string;
  delivered: number;
  failed: number;
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function ApprovalSection() {
  const [supported] = useState(() => isPushSupported());
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  );
  const [busy, setBusy] = useState<"subscribe" | "unsubscribe" | "request" | null>(null);
  const [lastRequest, setLastRequest] = useState<PendingRequest | null>(null);

  const { subscribe, unsubscribe } = usePushSubscribe();
  const requestFn = useServerFn(requestApproval);

  // Reflect current subscription state on mount (silently, no permission prompt).
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(!!sub);
      } catch {
        /* SW not ready — treat as not subscribed */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  async function handleToggle(next: boolean) {
    if (next) {
      setBusy("subscribe");
      try {
        const res = await subscribe();
        if (res.ok) {
          setSubscribed(true);
          setPermission("granted");
          toast.success("Push notifications enabled");
        } else {
          toast.error(
            res.reason === "denied"
              ? "Permission denied. Enable notifications in browser settings."
              : res.reason === "not_configured"
              ? "Push not configured on this build (VITE_VAPID_PUBLIC_KEY missing)."
              : res.reason === "unsupported"
              ? "This browser doesn't support WebPush."
              : `Couldn't subscribe (${res.reason})`,
          );
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Subscribe failed");
      } finally {
        setBusy(null);
      }
    } else {
      setBusy("unsubscribe");
      try {
        await unsubscribe();
        setSubscribed(false);
        toast.success("Push notifications disabled");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Unsubscribe failed");
      } finally {
        setBusy(null);
      }
    }
  }

  async function handleTestRequest() {
    setBusy("request");
    try {
      const res = await requestFn({
        data: {
          action: "approve_login",
          payload: { source: "security-page-test", ts: Date.now() },
        },
      });
      if (res.ok) {
        setLastRequest({
          nonceId: res.nonceId,
          expiresAt: res.expiresAt,
          delivered: (res.push as { delivered?: number }).delivered ?? 0,
          failed: (res.push as { failed?: number }).failed ?? 0,
        });
        toast.success(
          res.push && "delivered" in res.push && res.push.delivered > 0
            ? `Sent to ${res.push.delivered} device(s). Check your notifications.`
            : "Request created. Open the approve link to test locally.",
        );
      } else {
        toast.error("Couldn't create approval request");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const status = useMemo(() => {
    if (!supported) return "This browser doesn't support push notifications.";
    if (permission === "denied") return "Notifications blocked in browser settings.";
    if (subscribed) return "This device is subscribed to approval pushes.";
    return "Turn on to receive approval requests from your other devices.";
  }, [supported, permission, subscribed]);

  return (
    <>
      <SectionLabel>Cross-device approvals</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          icon={
            subscribed ? (
              <BellRing className="h-4 w-4" strokeWidth={1.8} />
            ) : (
              <BellOff className="h-4 w-4" strokeWidth={1.8} />
            )
          }
          title="Push notifications"
          subtitle={status}
          trailing={
            <Switch
              checked={subscribed}
              disabled={!supported || busy !== null || permission === "denied"}
              onCheckedChange={(v) => void handleToggle(v)}
              aria-label="Toggle push notifications"
            />
          }
        />
        <SettingsRow
          icon={
            busy === "request" ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : (
              <Send className="h-4 w-4" strokeWidth={1.8} />
            )
          }
          title="Send test approval"
          subtitle="Sends a signed request to every device subscribed to your account."
          onClick={busy === null ? handleTestRequest : undefined}
        />
      </SettingsGroup>

      {lastRequest && (
        <div
          className="mx-1 mb-3 rounded-lg p-3 text-xs"
          style={{ background: "#f7f4ed", border: `1px solid ${BORDER}` }}
        >
          <div className="mb-1 flex items-center gap-1.5" style={{ color: CHARCOAL }}>
            <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "#3c8c5a" }} />
            <span className="font-medium">Request created</span>
          </div>
          <div className="mb-2" style={{ color: MUTED }}>
            Delivered to {lastRequest.delivered} device(s)
            {lastRequest.failed > 0 && `, ${lastRequest.failed} failed`}. Expires{" "}
            {new Date(lastRequest.expiresAt).toLocaleTimeString()}.
          </div>
          <Link
            to="/approve"
            search={{ nonce: lastRequest.nonceId }}
            className="inline-flex items-center gap-1 hover:underline"
            style={{ color: CHARCOAL }}
          >
            Open approval page <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}
    </>
  );
}
