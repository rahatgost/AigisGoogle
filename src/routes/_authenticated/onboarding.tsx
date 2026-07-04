import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import Onboarding from "@/components/onboarding/Onboarding";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();

  const complete = useCallback(async () => {
    await supabase
      .from("profiles")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", user.id);
    navigate({ to: "/vault", replace: true });
  }, [navigate, user.id]);

  return <Onboarding onComplete={complete} />;
}
