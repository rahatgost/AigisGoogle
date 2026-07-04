import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Shield, Mail, Lock, ArrowRight, Loader2 } from "lucide-react";

const CREAM = "#f7f4ed";
const CHARCOAL = "#1c1c1a";
const MUTED = "#8a8a86";
const BORDER = "rgba(28,28,26,0.12)";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

type Mode = "signin" | "signup" | "reset";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  // If already signed in, bounce to landing router.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/auth/callback" },
        });
        if (error) throw error;
        setNotice({ kind: "info", text: "Account created. You can sign in now." });
        setMode("signin");
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/", replace: true });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/auth/reset-password",
        });
        if (error) throw error;
        setNotice({ kind: "info", text: "Check your inbox for a reset link." });
      }
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setNotice(null);
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/auth/callback",
      });
      if (result.error) throw new Error(result.error.message ?? "Google sign-in failed");
      if (result.redirected) return;
      navigate({ to: "/", replace: true });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Google sign-in failed." });
      setLoading(false);
    }
  };

  const title =
    mode === "signup" ? "Create your Aegis." : mode === "reset" ? "Reset your passphrase." : "Welcome back.";
  const subtitle =
    mode === "signup"
      ? "One account, every one-time code — quietly protected."
      : mode === "reset"
        ? "We'll email you a secure link to set a new password."
        : "Sign in to unlock your vault.";

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: CREAM, color: CHARCOAL }}
    >
      <div className="mx-auto flex h-full w-full max-w-[440px] flex-col px-6 pt-[max(20px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 pb-8">
          <Shield className="h-4 w-4" strokeWidth={1.8} />
          <span className="text-[13px] font-medium tracking-tight">Aegis</span>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-6">
          <div className="flex flex-col gap-2">
            <h1
              className="text-[34px] leading-[1.05] tracking-tight"
              style={{ fontFamily: "'Instrument Serif', serif" }}
            >
              {title}
            </h1>
            <p className="text-[14px] leading-relaxed" style={{ color: MUTED }}>
              {subtitle}
            </p>
          </div>

          <form onSubmit={handleEmail} className="flex flex-col gap-3">
            <Field icon={<Mail className="h-4 w-4" strokeWidth={1.6} />}>
              <input
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-[color:var(--muted-fg)]"
                style={{ color: CHARCOAL, ["--muted-fg" as string]: MUTED }}
              />
            </Field>

            {mode !== "reset" && (
              <Field icon={<Lock className="h-4 w-4" strokeWidth={1.6} />}>
                <input
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  required
                  minLength={8}
                  placeholder={mode === "signup" ? "Create a strong password" : "Your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent text-[15px] outline-none"
                  style={{ color: CHARCOAL }}
                />
              </Field>
            )}

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
              disabled={loading}
              className="mt-1 flex h-[46px] items-center justify-center gap-2 rounded-full text-[14px] font-medium transition-transform active:scale-[0.99] disabled:opacity-60"
              style={{ background: CHARCOAL, color: CREAM }}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}
                  <ArrowRight className="h-[15px] w-[15px]" strokeWidth={1.8} />
                </>
              )}
            </button>
          </form>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1" style={{ background: BORDER }} />
            <span className="text-[11px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>
              or
            </span>
            <div className="h-px flex-1" style={{ background: BORDER }} />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className="flex h-[46px] items-center justify-center gap-2.5 rounded-full border text-[14px] font-medium disabled:opacity-60"
            style={{ borderColor: BORDER, background: "rgba(255,255,255,0.6)" }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="flex flex-col items-center gap-1.5 pt-1 text-[13px]" style={{ color: MUTED }}>
            {mode === "signin" && (
              <>
                <button onClick={() => setMode("reset")} className="underline underline-offset-[3px]">
                  Forgot your password?
                </button>
                <div>
                  New to Aegis?{" "}
                  <button
                    onClick={() => setMode("signup")}
                    className="underline underline-offset-[3px]"
                    style={{ color: CHARCOAL }}
                  >
                    Create an account
                  </button>
                </div>
              </>
            )}
            {mode === "signup" && (
              <div>
                Already have an account?{" "}
                <button
                  onClick={() => setMode("signin")}
                  className="underline underline-offset-[3px]"
                  style={{ color: CHARCOAL }}
                >
                  Sign in
                </button>
              </div>
            )}
            {mode === "reset" && (
              <button
                onClick={() => setMode("signin")}
                className="underline underline-offset-[3px]"
                style={{ color: CHARCOAL }}
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl border px-3.5 h-[46px]"
      style={{ borderColor: BORDER, background: "rgba(255,255,255,0.55)" }}
    >
      <span style={{ color: MUTED }}>{icon}</span>
      {children}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
