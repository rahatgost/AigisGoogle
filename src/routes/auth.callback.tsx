import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const CREAM = "#f7f4ed";
const CHARCOAL = "#1c1c1a";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  component: CallbackPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

function CallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      navigate({ to: "/", replace: true });
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) go();
    });

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") go();
    });

    const timeout = window.setTimeout(() => {
      // No session materialized — send back to sign-in.
      if (!done) navigate({ to: "/auth", replace: true });
    }, 4000);

    return () => {
      data.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: CREAM, color: CHARCOAL }}
    >
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
