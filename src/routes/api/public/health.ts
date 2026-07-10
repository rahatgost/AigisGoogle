// Lightweight reachability probe used by the client to detect real
// server connectivity (captive Wi-Fi / dropped tunnels lie via
// `navigator.onLine`). Kept under `/api/public/*` so it's callable
// without an auth header. No PII, no DB access — just proof that the
// edge is reachable.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ ok: true, t: Date.now() }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        }),
      HEAD: async () =>
        new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } }),
    },
  },
});
