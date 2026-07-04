import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Shield, LogOut } from "lucide-react";

const CREAM = "#f7f4ed";
const CHARCOAL = "#1c1c1a";
const MUTED = "#8a8a86";

export const Route = createFileRoute("/_authenticated/vault")({
  component: VaultPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

function VaultPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: CREAM, color: CHARCOAL }}
    >
      <div className="mx-auto flex h-full w-full max-w-[440px] flex-col px-6 pt-[max(20px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
        <header className="flex items-center justify-between pb-6">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" strokeWidth={1.8} />
            <span className="text-[13px] font-medium tracking-tight">Aegis</span>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px]"
            style={{ color: MUTED }}
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
            Sign out
          </button>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "rgba(28,28,26,0.06)" }}
          >
            <Shield className="h-6 w-6" strokeWidth={1.6} />
          </div>
          <h1 className="text-2xl font-medium tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>
            Your vault is ready.
          </h1>
          <p className="max-w-[280px] text-[14px] leading-relaxed" style={{ color: MUTED }}>
            Signed in as {user.email}. One-time codes will land here in the next slice.
          </p>
        </div>
      </div>
    </div>
  );
}
