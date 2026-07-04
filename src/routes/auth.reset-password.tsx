import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, Lock, ArrowRight, Loader2 } from "lucide-react";

const CREAM = "#f7f4ed";
const CHARCOAL = "#1c1c1a";
const MUTED = "#8a8a86";
const BORDER = "rgba(28,28,26,0.12)";

export const Route = createFileRoute("/auth/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase parses the URL hash and fires PASSWORD_RECOVERY once ready.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    // Fallback: if a session exists, allow update.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setNotice({ kind: "info", text: "Password updated. Redirecting…" });
      setTimeout(() => navigate({ to: "/", replace: true }), 800);
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Could not update password." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: CREAM, color: CHARCOAL }}>
      <div className="mx-auto flex h-full w-full max-w-[440px] flex-col px-6 pt-[max(20px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 pb-8">
          <Shield className="h-4 w-4" strokeWidth={1.8} />
          <span className="text-[13px] font-medium tracking-tight">Aegis</span>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-[34px] leading-[1.05] tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>
              Set a new password.
            </h1>
            <p className="text-[14px]" style={{ color: MUTED }}>
              Choose something you'll remember — at least 8 characters.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div
              className="flex items-center gap-2.5 rounded-2xl border px-3.5 h-[46px]"
              style={{ borderColor: BORDER, background: "rgba(255,255,255,0.55)" }}
            >
              <Lock className="h-4 w-4" strokeWidth={1.6} style={{ color: MUTED }} />
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent text-[15px] outline-none"
                style={{ color: CHARCOAL }}
              />
            </div>

            {notice && (
              <div
                className="rounded-xl px-3 py-2 text-[12.5px] leading-snug"
                style={{
                  background: notice.kind === "error" ? "rgba(180,40,40,0.08)" : "rgba(28,28,26,0.05)",
                  color: notice.kind === "error" ? "#8a2020" : CHARCOAL,
                }}
              >
                {notice.text}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !ready}
              className="mt-1 flex h-[46px] items-center justify-center gap-2 rounded-full text-[14px] font-medium disabled:opacity-60"
              style={{ background: CHARCOAL, color: CREAM }}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Update password
                  <ArrowRight className="h-[15px] w-[15px]" strokeWidth={1.8} />
                </>
              )}
            </button>
            {!ready && (
              <p className="text-center text-[12px]" style={{ color: MUTED }}>
                Waiting for a valid reset link…
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
