import { createFileRoute } from "@tanstack/react-router";

/**
 * Stripe webhook — public endpoint (auth bypassed by /api/public/*).
 * Signature verification is mandatory; we reject anything without a
 * valid `Stripe-Signature` header. Writes subscription state to
 * `public.subscriptions` via the service-role client.
 *
 * Configure the endpoint URL + signing secret in your Stripe Dashboard
 * → Developers → Webhooks, then store the signing secret as
 * `STRIPE_WEBHOOK_SECRET`.
 */
export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) {
          return new Response("Webhook secret not configured", { status: 503 });
        }
        const signature = request.headers.get("stripe-signature");
        if (!signature) {
          return new Response("Missing Stripe-Signature", { status: 400 });
        }

        const raw = await request.text();
        const { getStripe, tierForPriceId } = await import("@/lib/stripe.server");
        const stripe = getStripe();

        let event: import("stripe").Stripe.Event;
        try {
          // Async variant works on the fetch-based (Web Crypto) HTTP client.
          event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "invalid signature";
          return new Response(`Signature verification failed: ${msg}`, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as {
          from: (t: string) => {
            upsert: (row: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
            update: (row: Record<string, unknown>) => {
              eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
            };
            select: (c: string) => {
              eq: (c: string, v: string) => {
                maybeSingle: () => Promise<{ data: { user_id: string } | null }>;
              };
            };
          };
        };

        const upsertFromSubscription = async (
          sub: import("stripe").Stripe.Subscription,
          userIdHint?: string | null,
        ) => {
          const userId =
            userIdHint ??
            (typeof sub.metadata?.user_id === "string" ? sub.metadata.user_id : null);
          if (!userId) return; // nothing to attach
          const item = sub.items.data[0];
          const priceId = item?.price?.id ?? null;
          const tier = tierForPriceId(priceId) ?? "free";
          const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;

          await admin.from("subscriptions").upsert(
            {
              user_id: userId,
              stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
              stripe_subscription_id: sub.id,
              tier,
              status: sub.status,
              current_period_end: periodEnd
                ? new Date(periodEnd * 1000).toISOString()
                : null,
              cancel_at_period_end: sub.cancel_at_period_end,
              price_id: priceId,
            },
            { onConflict: "user_id" },
          );
        };

        try {
          switch (event.type) {
            case "checkout.session.completed": {
              const session = event.data.object as import("stripe").Stripe.Checkout.Session;
              if (session.mode === "subscription" && session.subscription) {
                const subId =
                  typeof session.subscription === "string"
                    ? session.subscription
                    : session.subscription.id;
                const sub = await stripe.subscriptions.retrieve(subId);
                const userId =
                  session.client_reference_id ??
                  (typeof session.metadata?.user_id === "string" ? session.metadata.user_id : null);
                await upsertFromSubscription(sub, userId);
              }
              break;
            }
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
              const sub = event.data.object as import("stripe").Stripe.Subscription;
              await upsertFromSubscription(sub);
              break;
            }
            default:
              // Ignore other events (invoice.*, etc.) for now.
              break;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "handler error";
          console.error("[stripe-webhook]", event.type, msg);
          return new Response(`Handler error: ${msg}`, { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
