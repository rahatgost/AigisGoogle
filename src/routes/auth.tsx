import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useLingui } from "@lingui/react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Loader2, Mail, Shield } from "lucide-react";
import {
  BORDER,
  CHARCOAL,
  CREAM,
  CREAM_SOFT,
  DANGER,
  GoogleIcon,
  MUTED,
  inputClass,
  inputStyle,
  soft,
  spring,
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

/* -------------------------------------------------------------------------- */
/*  Starfield hero — dark charcoal panel with soft radial glow + stars        */
/* -------------------------------------------------------------------------- */

interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
  d: number;
}

function useStars(count: number): Star[] {
  return useMemo(() => {
    // Deterministic pseudo-random so SSR/CSR match (though this route is ssr:false).
    let seed = 7;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    return Array.from({ length: count }, () => ({
      x: rand() * 100,
      y: rand() * 100,
      r: rand() * 1.2 + 0.3,
      o: rand() * 0.5 + 0.25,
      d: rand() * 3 + 2,
    }));
  }, [count]);
}

function Starfield() {
  const reduce = useReducedMotion();
  const stars = useStars(70);
  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 80% at 78% 12%, rgba(255,255,255,0.10), transparent 55%), radial-gradient(80% 80% at 10% 0%, rgba(255,255,255,0.05), transparent 55%), linear-gradient(180deg, #0d0d1b 0%, #10101f 55%, #16162a 100%)",
      }}
    >
      {/* faint grid */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(120% 90% at 70% 10%, black 30%, transparent 80%)",
        }}
      />
      {/* stars */}
      {stars.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.r,
            height: s.r,
            opacity: s.o,
            boxShadow: s.r > 1 ? "0 0 4px rgba(255,255,255,0.6)" : undefined,
          }}
          animate={reduce ? undefined : { opacity: [s.o, s.o * 0.35, s.o] }}
          transition={{ duration: s.d, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function BrandRow() {
  return (
    <div className="flex items-center gap-2 text-white">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-[9px]"
        style={{
          background: "linear-gradient(140deg, #4f6bff 0%, #2b3ec9 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(79,107,255,0.55)",
        }}
      >
        <Shield className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Aegis</span>
    </div>
  );
}

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
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: "#0d0d1b" }}
    >
      {/* ---------------- Dark hero ---------------- */}
      <div className="relative shrink-0" style={{ minHeight: "36vh" }}>
        <Starfield />
        <div className="relative z-10 flex h-full flex-col px-6 pt-[max(28px,env(safe-area-inset-top))] pb-8">
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={soft}
          >
            <BrandRow />
          </motion.div>

          <div className="mt-8 flex flex-col gap-2.5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.h1
                key={mode + "-hero"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={soft}
                className="text-white"
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontSize: 40,
                  lineHeight: 1.05,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                }}
              >
                {heroTitle}
              </motion.h1>
            </AnimatePresence>
            <motion.p
              key={mode + "-sub"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 0.72, y: 0 }}
              transition={{ ...soft, delay: 0.05 }}
              className="max-w-[34ch] text-[14.5px] leading-[1.5] text-white"
            >
              {heroSub}
            </motion.p>
          </div>
        </div>
      </div>

      {/* ---------------- Sheet ---------------- */}
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...soft, delay: 0.05 }}
        className="relative -mt-6 flex flex-1 flex-col overflow-y-auto rounded-t-[28px] px-6 pt-6 pb-[max(24px,env(safe-area-inset-bottom))]"
        style={{
          background: CREAM,
          boxShadow: "0 -14px 40px -20px rgba(0,0,0,0.35)",
          color: CHARCOAL,
        }}
      >
        <div className="mx-auto flex w-full max-w-[440px] flex-col gap-5">
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
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-[15px] w-[15px] rounded-[4px] border"
                    style={{ accentColor: "#3b52e0", borderColor: BORDER }}
                  />
                  {t("auth.rememberMe", "Remember me")}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setMode("reset");
                  }}
                  className="font-medium"
                  style={{ color: "#3b52e0" }}
                >
                  {t("auth.link.forgot", "Forgot password?")}
                </button>
              </div>
            )}

            {notice && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={soft}
                className="rounded-[10px] px-3 py-2 text-[12.5px] leading-snug"
                style={{
                  background:
                    notice.kind === "error"
                      ? "rgb(var(--aegis-danger-rgb) / 0.08)"
                      : "rgb(var(--aegis-ink-rgb) / 0.05)",
                  color: notice.kind === "error" ? DANGER : CHARCOAL,
                  border: `1px solid ${
                    notice.kind === "error" ? "rgb(var(--aegis-danger-rgb) / 0.15)" : BORDER
                  }`,
                }}
              >
                {notice.text}
              </motion.div>
            )}

            <BlueButton
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
              onClick={() => setMode("signin")}
              className="mx-auto text-[13px] font-medium"
              style={{ color: "#3b52e0" }}
            >
              {t("auth.backToSignin", "Back to sign in")}
            </button>
          )}
        </div>
      </motion.div>
    </div>
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

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="text-[12.5px] font-medium"
        style={{ color: MUTED, letterSpacing: "-0.005em" }}
      >
        {label}
      </span>
      <div
        className="flex h-[48px] items-center gap-2.5 rounded-[12px] px-3.5"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function BlueButton({
  children,
  type = "button",
  loading,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  type?: "button" | "submit";
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      whileTap={disabled || loading ? undefined : { scale: 0.985, opacity: 0.95 }}
      transition={spring}
      className="relative flex h-[50px] w-full items-center justify-center rounded-[12px] text-[15px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60"
      style={{
        background: "linear-gradient(180deg, #4f6bff 0%, #3548d1 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.28), 0 12px 24px -12px rgba(53,72,209,0.55), 0 2px 4px rgba(53,72,209,0.2)",
        letterSpacing: "-0.005em",
        ["--tw-ring-color" as string]: "rgba(53,72,209,0.55)",
        ["--tw-ring-offset-color" as string]: CREAM,
      }}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </motion.button>
  );
}
