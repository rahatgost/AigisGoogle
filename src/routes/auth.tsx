import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLingui } from "@lingui/react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Mail } from "lucide-react";
import {
  BORDER,
  CHARCOAL,
  CREAM_SOFT,
  GoogleIcon,
  MUTED,
  inputClass,
  inputStyle,
  soft,
  spring,
} from "@/components/aegis/chrome";
import { PasswordField, StrengthMeter, scoreStrength } from "@/components/aegis/password-field";
import {
  BlueButton,
  FieldGroup,
  InlineNotice,
  StarfieldHeroLayout,
} from "@/components/aegis/starfield-hero";

const LAST_EMAIL_KEY = "aegis.auth.lastEmail";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in to Aegis — Secure TOTP authenticator" },
      {
        name: "description",
        content:
          "Sign in or create your Aegis account to sync end-to-end encrypted TOTP codes across your devices.",
      },
      { property: "og:title", content: "Sign in to Aegis" },
      {
        property: "og:description",
        content:
          "Access your zero-knowledge, end-to-end encrypted authenticator vault.",
      },
      { property: "og:url", content: "https://aegis-v2.flinkeo.online/auth" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://aegis-v2.flinkeo.online/auth" }],
  }),
  component: AuthPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => <NotFoundView />,
});

function NotFoundView() {
  const { i18n } = useLingui();
  const msg = i18n._("auth.notFound");
  return <div className="p-6 text-sm">{msg === "auth.notFound" ? "Not found" : msg}</div>;
}

type Mode = "signin" | "signup" | "reset";




/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

function AuthPage() {
  const navigate = useNavigate();
  const { i18n } = useLingui();
  const t = (id: string, fallback: string) => {
    const m = i18n._(id);
    return m === id ? fallback : m;
  };
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    try {
      const last = window.localStorage.getItem(LAST_EMAIL_KEY);
      if (last) setEmail(last);
    } catch {
      /* ignore */
    }
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
        setNotice({ kind: "info", text: t("auth.notice.signupSuccess", "Account created. You can sign in now.") });
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
        setNotice({ kind: "info", text: t("auth.notice.resetSent", "Check your inbox for a reset link.") });
      }
      try {
        if (remember) window.localStorage.setItem(LAST_EMAIL_KEY, email);
        else window.localStorage.removeItem(LAST_EMAIL_KEY);
      } catch {
        /* ignore */
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : t("auth.error.generic", "Something went wrong.");
      const friendly = /invalid.*credent|invalid.*login/i.test(raw)
        ? t("auth.error.invalidCredentials", "Email or password is incorrect.")
        : /rate limit|too many/i.test(raw)
          ? t("auth.error.rateLimit", "Too many attempts — please wait a moment and try again.")
          : /already.*registered/i.test(raw)
            ? t("auth.error.alreadyRegistered", "An account with that email already exists.")
            : raw;
      setNotice({ kind: "error", text: friendly });
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
      if (result.error) throw new Error(result.error.message ?? t("auth.error.google", "Google sign-in failed."));
      if (result.redirected) return;
      navigate({ to: "/", replace: true });
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : t("auth.error.google", "Google sign-in failed."),
      });
      setLoading(false);
    }
  };

  const heroTitle =
    mode === "signup"
      ? t("auth.hero.titleSignup", "Create your vault")
      : mode === "reset"
        ? t("auth.hero.titleReset", "Reset your access")
        : t("auth.hero.title", "Get Started now");
  const heroSub =
    mode === "reset"
      ? t("auth.hero.subReset", "We'll send a secure link to set a new password.")
      : t("auth.hero.sub", "Create an account or log in to sync your codes.");

  return (
    <StarfieldHeroLayout
      heroKey={mode}
      heroTitle={heroTitle}
      heroSubtitle={heroSub}
    >
      <div className="flex flex-col gap-5">
        <SegmentedTabs
          mode={mode}
          onChange={(next) => {
            setNotice(null);
            setMode(next);
          }}
        />



          <form onSubmit={handleEmail} className="flex flex-col gap-4">
            <FieldGroup label={t("auth.field.email", "Email")}>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0" strokeWidth={1.6} style={{ color: MUTED }} />
                <input
                  data-testid="auth-email-input"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder={t("auth.email.placeholder", "you@example.com")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </FieldGroup>

            <AnimatePresence initial={false}>
              {mode !== "reset" && (
                <motion.div
                  key="pw-group"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={soft}
                  className="overflow-hidden"
                >
                  <div className="flex flex-col gap-1.5">
                    <span
                      className="text-[12.5px] font-medium"
                      style={{ color: MUTED, letterSpacing: "-0.005em" }}
                    >
                      {t("auth.field.password", "Password")}
                    </span>
                    <PasswordField
                      testId="auth-password-input"
                      value={password}
                      onChange={setPassword}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      minLength={mode === "signup" ? 8 : undefined}
                      placeholder={
                        mode === "signup"
                          ? t("auth.password.placeholder.signup", "Create a strong password")
                          : t("auth.password.placeholder.signin", "Your password")
                      }
                    />
                    {mode === "signup" && (
                      <div className="mt-1">
                        <StrengthMeter value={password} />
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {mode === "signin" && (
              <div className="flex items-center justify-between text-[13px]">
                <label className="flex cursor-pointer items-center gap-2 select-none" style={{ color: MUTED }}>
                  <input
                    type="checkbox"
                    data-testid="auth-remember-checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-[15px] w-[15px] rounded-[4px] border"
                    style={{ accentColor: CHARCOAL, borderColor: BORDER }}
                  />
                  {t("auth.rememberMe", "Remember me")}
                </label>
                <button
                  type="button"
                  data-testid="auth-forgot-password-button"
                  onClick={() => {
                    setNotice(null);
                    setMode("reset");
                  }}
                  className="font-medium"
                  style={{ color: CHARCOAL }}
                >
                  {t("auth.link.forgot", "Forgot password?")}
                </button>
              </div>
            )}

            {notice && <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice>}

            <BlueButton
              testId="auth-submit-button"
              type="submit"
              loading={loading}
              disabled={
                !email ||
                (mode !== "reset" && !password) ||
                (mode === "signup" && scoreStrength(password) < 2)
              }
            >
              {mode === "signup"
                ? t("auth.button.signup", "Sign Up")
                : mode === "reset"
                  ? t("auth.button.reset", "Send reset link")
                  : t("auth.button.signin", "Log In")}
            </BlueButton>
          </form>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1" style={{ background: BORDER }} />
            <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: MUTED }}>
              {t("auth.divider.or", "Or")}
            </span>
            <div className="h-px flex-1" style={{ background: BORDER }} />
          </div>

          <button
            type="button"
            data-testid="auth-google-button"
            onClick={handleGoogle}
            disabled={loading}
            className="flex h-[48px] w-full items-center justify-center gap-3 rounded-[12px] text-[14.5px] font-medium transition-colors disabled:opacity-60"
            style={{
              background: CREAM_SOFT,
              color: CHARCOAL,
              border: `1px solid ${BORDER}`,
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
          >
            <GoogleIcon size={18} />
            {t("auth.google.cta", "Continue with Google")}
          </button>

          {mode === "reset" && (
            <button
              type="button"
              data-testid="auth-back-to-signin-button"
              onClick={() => setMode("signin")}
              className="mx-auto text-[13px] font-medium"
              style={{ color: CHARCOAL }}
            >
              {t("auth.backToSignin", "Back to sign in")}
            </button>
          )}
      </div>
    </StarfieldHeroLayout>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sheet primitives                                                          */
/* -------------------------------------------------------------------------- */

function SegmentedTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  // Only two visible tabs; "reset" folds under Log In.
  const active: "signin" | "signup" = mode === "signup" ? "signup" : "signin";
  return (
    <div
      className="relative grid h-[48px] grid-cols-2 rounded-[12px] p-1"
      style={{ background: "rgb(var(--aegis-ink-rgb) / 0.05)" }}
    >
      <motion.div
        aria-hidden
        layout
        transition={spring}
        className="absolute inset-y-1 w-[calc(50%-4px)] rounded-[9px]"
        style={{
          left: active === "signin" ? 4 : "calc(50% + 0px)",
          background: CREAM_SOFT,
          boxShadow: "0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.03)",
        }}
      />
      {(["signin", "signup"] as const).map((k) => (
        <button
          key={k}
          type="button"
          data-testid={`auth-${k}-tab`}
          onClick={() => onChange(k)}
          className="relative z-10 flex items-center justify-center text-[14px] font-medium transition-colors"
          style={{
            color: active === k ? CHARCOAL : MUTED,
            letterSpacing: "-0.005em",
          }}
        >
          {k === "signin" ? "Log In" : "Sign Up"}
        </button>
      ))}
    </div>
  );
}

