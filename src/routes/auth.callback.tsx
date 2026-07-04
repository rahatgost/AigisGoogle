import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AegisScreen, BrandBar, Display, Lede, INSET_SHADOW, CREAM_SOFT, CHARCOAL, BORDER } from "@/components/aegis/chrome";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  component: CallbackPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

function CallbackPage() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();

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
    <AegisScreen>
      <BrandBar />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{ width: 70 + i * 24, height: 70 + i * 24, border: `1px solid ${BORDER}` }}
              animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.9, 0.3, 0.9] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.25 }}
            />
          ))}
          <motion.div
            className="relative flex h-[64px] w-[64px] items-center justify-center rounded-full"
            style={{ background: CHARCOAL, boxShadow: INSET_SHADOW }}
            animate={reduce ? undefined : { rotate: [0, 6, 0, -6, 0] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <ShieldCheck className="h-7 w-7" style={{ color: CREAM_SOFT }} strokeWidth={1.6} />
          </motion.div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Display>Signing you in…</Display>
          <Lede>Confirming your session — this only takes a moment.</Lede>
        </div>
        <Loader2 className="h-4 w-4 animate-spin opacity-60" />
      </div>
    </AegisScreen>
  );
}
