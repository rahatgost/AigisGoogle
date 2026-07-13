import { createFileRoute, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isGuestOnboarded } from "@/lib/guest-user";

const CREAM = "var(--aegis-cream)";
const CHARCOAL = "var(--aegis-ink)";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    // Local-only guest mode: no session required. Route to onboarding
    // for a first-time visitor, then straight to the vault.
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      if (!isGuestOnboarded()) {
        throw redirect({ to: "/onboarding" });
      }
      throw redirect({ to: "/vault" });
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarded_at")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (!profile?.onboarded_at) {
      throw redirect({ to: "/onboarding" });
    }
    throw redirect({ to: "/vault" });
  },
  component: LandingSpinner,
});

function LandingSpinner() {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: CREAM, color: CHARCOAL }}
    >
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
