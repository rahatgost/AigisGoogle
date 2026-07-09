import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getLimit, type PlanTier } from "@/lib/plan";

/**
 * Phase 13.3 — Billing server functions.
 *
 * All three are user-scoped and go through `requireSupabaseAuth`. The
 * webhook route (public, at /api/public/stripe-webhook) is what actually
 * writes to `public.subscriptions`; these functions only read the row
 * and mint Stripe Checkout / Portal sessions.
 */

type SubRow = {
  user_id: string;
  tier: "free" | "pro" | "family";
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  price_id: string | null;
};

export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubRow> => {
    const client = context.supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: SubRow | null; error: { message: string } | null }>;
          };
        };
      };
    };
    const { data, error } = await client
      .from("subscriptions")
      .select(
        "user_id,tier,status,current_period_end,cancel_at_period_end,stripe_customer_id,price_id",
      )
      .eq("user_id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (
      data ?? {
        user_id: context.userId,
        tier: "free",
        status: "active",
        current_period_end: null,
        cancel_at_period_end: false,
        stripe_customer_id: null,
        price_id: null,
      }
    );
  });

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ tier: z.enum(["pro", "family"]), origin: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getStripe, priceIdForTier } = await import("@/lib/stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const stripe = getStripe();

    // Find/create Stripe customer
    let customerId: string | null = null;
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: { stripe_customer_id: string | null } | null }>;
          };
        };
        upsert: (row: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      };
    };
    const existing = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    customerId = existing.data?.stripe_customer_id ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: context.claims.email ?? undefined,
        metadata: { user_id: context.userId },
      });
      customerId = customer.id;
      await admin.from("subscriptions").upsert(
        { user_id: context.userId, stripe_customer_id: customerId, tier: "free", status: "incomplete" },
        { onConflict: "user_id" },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceIdForTier(data.tier), quantity: 1 }],
      success_url: `${data.origin}/profile?checkout=success`,
      cancel_url: `${data.origin}/profile?checkout=cancel`,
      allow_promotion_codes: true,
      client_reference_id: context.userId,
      metadata: { user_id: context.userId, tier: data.tier },
      subscription_data: { metadata: { user_id: context.userId, tier: data.tier } },
    });

    return { url: session.url };
  });

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ origin: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getStripe } = await import("@/lib/stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const stripe = getStripe();

    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: { stripe_customer_id: string | null } | null }>;
          };
        };
      };
    };
    const { data: row } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!row?.stripe_customer_id) {
      throw new Error("No billing profile yet — start a subscription first.");
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${data.origin}/profile`,
    });

    return { url: session.url };
  });

/**
 * Pre-flight check used by import/add flows. Reads the caller's tier and
 * current vault-entry count and returns whether `additional` new rows
 * would exceed the plan cap. This mirrors the DB trigger
 * `enforce_vault_accounts_per_user_limit` so the UI can surface a
 * friendly upgrade prompt before the write is even attempted.
 */
export const checkAccountQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ additional: z.number().int().min(0).max(10_000).default(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const client = context.supabase as unknown as {
      from: (t: string) => {
        select: (c: string, opts?: { count?: "exact"; head?: boolean }) => {
          eq: (c: string, v: string) => Promise<{ count: number | null; error: { message: string } | null }> & {
            maybeSingle: () => Promise<{ data: { tier: PlanTier } | null; error: { message: string } | null }>;
          };
        };
      };
    };

    const sub = await client
      .from("subscriptions")
      .select("tier")
      .eq("user_id", context.userId)
      .maybeSingle();
    const tier: PlanTier = (sub.data?.tier as PlanTier | undefined) ?? "free";

    const countRes = await client
      .from("vault_accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId);
    const current = countRes.count ?? 0;

    const cap = getLimit(tier, "maxAccounts");
    const finite = Number.isFinite(cap);
    const projected = current + data.additional;
    const allowed = !finite || projected <= cap;
    const remaining = finite ? Math.max(0, cap - current) : Number.POSITIVE_INFINITY;

    return {
      tier,
      cap: finite ? cap : null,
      current,
      remaining: Number.isFinite(remaining) ? remaining : null,
      allowed,
      requested: data.additional,
    };
  });
