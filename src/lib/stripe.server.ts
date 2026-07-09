import Stripe from "stripe";

/**
 * Shared Stripe client for server functions and webhook routes.
 * Uses the fetch-based HTTP client so it runs on the Cloudflare Worker
 * runtime (no Node `http` needed).
 */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, {
    // Cast: pin a known version without depending on Stripe's internal ApiVersion literal type.
    apiVersion: "2025-01-27.acacia" as Stripe.StripeConfig["apiVersion"] extends never
      ? never
      : Stripe.StripeConfig["apiVersion"],
    httpClient: Stripe.createFetchHttpClient(),
  } as Stripe.StripeConfig);
}

/**
 * Map plan tier → Stripe Price ID. Configured via env vars because prices
 * live in the customer's Stripe dashboard.
 */
export function priceIdForTier(tier: "pro" | "family"): string {
  const id =
    tier === "pro"
      ? process.env.STRIPE_PRICE_PRO
      : process.env.STRIPE_PRICE_FAMILY;
  if (!id) {
    throw new Error(
      `Missing STRIPE_PRICE_${tier.toUpperCase()} env var. Create a Product/Price in Stripe and add the price id as a secret.`,
    );
  }
  return id;
}

/**
 * Map a Stripe Price ID back to our plan tier.
 */
export function tierForPriceId(priceId: string | null | undefined): "pro" | "family" | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_FAMILY) return "family";
  return null;
}
