import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2, ShieldCheck } from "lucide-react";
import { useLingui } from "@lingui/react";
import { supabase } from "@/integrations/supabase/client";
import { MUTED } from "@/components/aegis/chrome";
import { StarfieldHeroLayout } from "@/components/aegis/starfield-hero";

export const Route = createFileRoute("/auth_/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing you in — Aegis" },
      {
        name: "description",
        content: "Completing your Aegis sign-in. This page redirects automatically.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Signing you in — Aegis" },
      {
        property: "og:description",
        content: "OAuth callback handler for Aegis sign-in.",
      },
      { property: "og:url", content: "https://aegis-v2.flinkeo.online/auth/callback" },
    ],
  }),
  component: CallbackPage,
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

function CallbackPage() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { i18n } = useLingui();
  const t = (id: string, fallback: string) => {
    const m = i18n._(id);
    return m === id ? fallback : m;
  };

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
      if (!done) navigate({ to: "/auth", replace: true });
    }, 4000);
    return () => {
      data.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <StarfieldHeroLayout
      heroTitle={t("authCallback.title", "Signing you in…")}
      heroSubtitle={t(
        "authCallback.subtitle",
        "Confirming your session — this only takes a moment.",
      )}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6 text-center">
        <div
          className="relative flex items-center justify-center"
          style={{ width: 120, height: 120 }}
        >
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{
                width: 60 + i * 22,
                height: 60 + i * 22,
                border: "1px solid rgb(var(--aegis-ink-rgb) / 0.12)",
              }}
              animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.9, 0.3, 0.9] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.25 }}
            />
          ))}
          <motion.div
            className="relative flex h-[58px] w-[58px] items-center justify-center rounded-full text-white"
            style={{
              background: "linear-gradient(180deg, #2b2926 0%, #1c1c1c 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 24px -12px rgba(28,28,28,0.58)",
            }}
            animate={reduce ? undefined : { rotate: [0, 6, 0, -6, 0] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <ShieldCheck className="h-7 w-7" strokeWidth={1.6} />
          </motion.div>
        </div>
        <div
          className="flex items-center gap-2 text-[13px]"
          style={{ color: MUTED }}
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("authCallback.status", "One moment…")}
        </div>
      </div>
    </StarfieldHeroLayout>
  );
}
