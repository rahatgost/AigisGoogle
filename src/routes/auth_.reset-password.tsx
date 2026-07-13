import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError } from "@/lib/friendly-errors";
import { MUTED } from "@/components/aegis/chrome";
import { PasswordField, StrengthMeter, scoreStrength } from "@/components/aegis/password-field";
import {
  BlueButton,
  InlineNotice,
  StarfieldHeroLayout,
} from "@/components/aegis/starfield-hero";

export const Route = createFileRoute("/auth_/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset your Aegis password" },
      {
        name: "description",
        content:
          "Choose a new password for your Aegis account. Your encrypted vault stays untouched.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Reset your Aegis password" },
      {
        property: "og:description",
        content: "Set a new password on your Aegis account.",
      },
      { property: "og:url", content: "https://aegis-v2.flinkeo.online/auth/reset-password" },
    ],
  }),
  component: ResetPasswordPage,
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

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { i18n } = useLingui();
  const t = (id: string, fallback: string) => {
    const m = i18n._(id);
    return m === id ? fallback : m;
  };
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
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
      setNotice({ kind: "info", text: t("authReset.success", "Password updated. Redirecting…") });
      setTimeout(() => navigate({ to: "/", replace: true }), 800);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : t("authReset.error", "Could not update password."),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <StarfieldHeroLayout
      heroTitle={t("authReset.title", "Set a new password")}
      heroSubtitle={t(
        "authReset.subtitle",
        "Choose something you'll remember — at least 8 characters.",
      )}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span
            className="text-[12.5px] font-medium"
            style={{ color: MUTED, letterSpacing: "-0.005em" }}
          >
            {t("authReset.fieldLabel", "New password")}
          </span>
          <PasswordField
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={8}
            placeholder={t("authReset.placeholder", "New password")}
          />
          <div className="mt-1">
            <StrengthMeter value={password} />
          </div>
        </div>

        {notice && <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice>}

        <BlueButton
          type="submit"
          loading={loading}
          disabled={!ready || scoreStrength(password) < 2}
        >
          {t("authReset.button", "Update password")}
        </BlueButton>

        {!ready && (
          <p className="text-center text-[12px]" style={{ color: MUTED }}>
            {t("authReset.waiting", "Waiting for a valid reset link…")}
          </p>
        )}
      </form>
    </StarfieldHeroLayout>
  );
}
