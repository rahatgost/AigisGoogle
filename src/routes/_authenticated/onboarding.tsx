import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useLingui } from "@lingui/react";
import Onboarding from "@/components/onboarding/Onboarding";
import { supabase } from "@/integrations/supabase/client";
import { isGuestId, markGuestOnboarded } from "@/lib/guest-user";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your Aegis vault" },
      {
        name: "description",
        content:
          "Create your passphrase and recovery so Aegis can encrypt your TOTP codes end-to-end.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Set up your Aegis vault" },
      {
        property: "og:description",
        content: "One-time setup: passphrase, recovery, and encrypted device pairing.",
      },
      { property: "og:url", content: "https://aegis-v2.flinkeo.online/onboarding" },
    ],
  }),
  component: OnboardingPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm">
      {error.message}
    </div>
  ),
  notFoundComponent: NotFound,
});

function NotFound() {
  const { i18n } = useLingui();
  const m = i18n._("onb.notFound");
  return <div className="p-6 text-sm">{m === "onb.notFound" ? "Not found" : m}</div>;
}


function OnboardingPage() {
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();

  const complete = useCallback(async () => {
    if (isGuestId(user.id)) {
      markGuestOnboarded();
    } else {
      await supabase
        .from("profiles")
        .update({ onboarded_at: new Date().toISOString() })
        .eq("id", user.id);
    }
    navigate({ to: "/vault", replace: true });
  }, [navigate, user.id]);

  return <Onboarding onComplete={complete} />;
}
