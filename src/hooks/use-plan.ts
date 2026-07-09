import { useQuery } from "@tanstack/react-query";
import { getMySubscription } from "@/lib/subscriptions.functions";
import { hasFeature, getLimit, type PlanTier, type PlanFeature, type PlanLimit } from "@/lib/plan";

/**
 * `usePlan()` — single source of truth for tier/feature checks in the UI.
 * Fails closed to `free` while loading so a gated feature never leaks
 * before the subscription row resolves.
 */
export function usePlan() {
  const query = useQuery({
    queryKey: ["subscription", "me"],
    queryFn: () => getMySubscription(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const tier: PlanTier = (query.data?.tier as PlanTier | undefined) ?? "free";
  const status = query.data?.status ?? "active";
  const active = tier === "free" || ["active", "trialing"].includes(status);
  const effectiveTier: PlanTier = active ? tier : "free";

  return {
    tier: effectiveTier,
    rawTier: tier,
    status,
    isPro: effectiveTier === "pro" || effectiveTier === "family",
    isFamily: effectiveTier === "family",
    isFree: effectiveTier === "free",
    hasFeature: (f: PlanFeature) => hasFeature(effectiveTier, f),
    getLimit: (k: PlanLimit) => getLimit(effectiveTier, k),
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
