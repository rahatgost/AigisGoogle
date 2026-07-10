import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLingui } from "@lingui/react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Mail, ShieldCheck } from "lucide-react";
import {
  AegisScreen,
  BrandBar,
  Display,
  Eyebrow,
  Field,
  GhostButton,
  GoogleIcon,
  HeroIcon,
  Lede,
  MUTED,
  Notice,
  PrimaryButton,
  TextLink,
  BORDER,
  CHARCOAL,
  inputClass,
  inputStyle,
  soft,
} from "@/components/aegis/chrome";
import { PasswordField, StrengthMeter, scoreStrength } from "@/components/aegis/password-field";

const LAST_EMAIL_KEY = "aegis.auth.lastEmail";

export const Route = createFileRoute("/auth")({
  ssr: false,
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
      { property: "og:url", content: "https://hug-machine-maker.lovable.app/auth" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://hug-machine-maker.lovable.app/auth" }],
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
        window.localStorage.setItem(LAST_EMAIL_KEY, email);
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

  const eyebrow =
    mode === "signup"
      ? t("auth.eyebrow.signup", "Create account")
      : mode === "reset"
        ? t("auth.eyebrow.reset", "Reset access")
        : t("auth.eyebrow.signin", "Sign in");
  const title =
    mode === "signup"
      ? t("auth.title.signup", "Create your Aegis account")
      : mode === "reset"
        ? t("auth.title.reset", "Reset your password")
        : t("auth.title.signin", "Sign in to your Aegis account");
  const subtitle =
    mode === "signup"
      ? t("auth.subtitle.signup", "One account, every one-time code — quietly protected.")
      : mode === "reset"
        ? t("auth.subtitle.reset", "We'll email you a secure link to set a new password.")
        : t("auth.subtitle.signin", "Sign in to unlock your vault.");

  return (
    <AegisScreen>
      <BrandBar />
      <div className="flex flex-1 flex-col justify-center gap-6 pt-2">
        <div className="flex flex-col items-center gap-5 text-center">
          <HeroIcon Icon={ShieldCheck} />
          <div className="flex flex-col items-center gap-3">
            <Eyebrow>{eyebrow}</Eyebrow>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode + "-title"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={soft}
                className="flex flex-col items-center gap-2"
              >
                <Display>{title}</Display>
                <Lede>{subtitle}</Lede>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <form onSubmit={handleEmail} className="flex flex-col gap-2.5">
          <Field icon={<Mail className="h-4 w-4" strokeWidth={1.6} />} delay={0.05}>
            <input
              type="email"
              autoComplete="email"
              required
              placeholder={t("auth.email.placeholder", "you@example.com")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </Field>

          <AnimatePresence initial={false}>
            {mode !== "reset" && (
              <motion.div
                key="pw"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={soft}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-1.5">
                  <PasswordField
                    value={password}
                    onChange={setPassword}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    minLength={mode === "signup" ? 8 : undefined}
                    placeholder={
                      mode === "signup"
                        ? t("auth.password.placeholder.signup", "Create a strong password")
                        : t("auth.password.placeholder.signin", "Your password")
                    }
                    delay={0.1}
                  />
                  {mode === "signup" && <StrengthMeter value={password} />}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

          <div className="pt-1">
            <PrimaryButton
              type="submit"
              loading={loading}
              disabled={
                !email ||
                (mode !== "reset" && !password) ||
                (mode === "signup" && scoreStrength(password) < 2)
              }
            >
              {mode === "signup"
                ? t("auth.button.signup", "Create account")
                : mode === "reset"
                  ? t("auth.button.reset", "Send reset link")
                  : t("auth.button.signin", "Sign in")}
            </PrimaryButton>
          </div>
        </form>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: BORDER }} />
          <span className="text-[11px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>
            {t("auth.divider.or", "or")}
          </span>
          <div className="h-px flex-1" style={{ background: BORDER }} />
        </div>

        <GhostButton onClick={handleGoogle} disabled={loading} icon={<GoogleIcon />}>
          {t("auth.google.cta", "Continue with Google")}
        </GhostButton>

        <div
          className="flex flex-col items-center gap-1.5 pt-1 text-[13px]"
          style={{ color: MUTED }}
        >
          {mode === "signin" && (
            <>
              <TextLink onClick={() => setMode("reset")}>
                {t("auth.link.forgot", "Forgot your password?")}
              </TextLink>
              <div>
                {t("auth.newToAegis", "New to Aegis?")}{" "}
                <button
                  onClick={() => setMode("signup")}
                  className="underline decoration-[rgb(var(--aegis-ink-rgb)/0.35)] underline-offset-[3px] transition-colors hover:decoration-[rgb(var(--aegis-ink-rgb)/0.7)]"
                  style={{ color: CHARCOAL }}
                >
                  {t("auth.createAccountLink", "Create an account")}
                </button>
              </div>
            </>
          )}
          {mode === "signup" && (
            <div>
              {t("auth.haveAccount", "Already have an account?")}{" "}
              <button
                onClick={() => setMode("signin")}
                className="underline decoration-[rgb(var(--aegis-ink-rgb)/0.35)] underline-offset-[3px] transition-colors hover:decoration-[rgb(var(--aegis-ink-rgb)/0.7)]"
                style={{ color: CHARCOAL }}
              >
                {t("auth.signinLink", "Sign in")}
              </button>
            </div>
          )}

          {mode === "reset" && (
            <TextLink onClick={() => setMode("signin")}>
              {t("auth.backToSignin", "Back to sign in")}
            </TextLink>
          )}
        </div>
      </div>
    </AegisScreen>
  );
}
