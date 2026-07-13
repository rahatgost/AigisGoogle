import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { I18nProvider } from "@lingui/react";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { THEME_INIT_SCRIPT, initTheme, setThemePref, type ThemePref } from "@/lib/theme";
import {
  LOCALE_INIT_SCRIPT,
  i18n,
  initLocale,
  setLocalePref,
  type LocalePref,
} from "@/lib/i18n";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#f7f4ed" },
      { title: "Aegis — Security that simply works" },
      {
        name: "description",
        content:
          "Aegis is a beautifully minimal authenticator that protects every account with secure one-time codes.",
      },
      { property: "og:title", content: "Aegis — Security that simply works" },
      {
        property: "og:description",
        content:
          "Aegis is a beautifully minimal authenticator that protects every account with secure one-time codes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Aegis — Security that simply works" },
      {
        name: "twitter:description",
        content:
          "Aegis is a beautifully minimal authenticator that protects every account with secure one-time codes.",
      },
      { property: "og:site_name", content: "Aegis" },
      { property: "og:url", content: "https://aegis-v2.flinkeo.online/" },
      {
        property: "og:image",
        content: "https://aegis-v2.flinkeo.online/og-aegis.jpg",
      },
      {
        name: "twitter:image",
        content: "https://aegis-v2.flinkeo.online/og-aegis.jpg",
      },
      {
        name: "google-site-verification",
        content: "V9MbQQzxpggv1Jc7hg7Y38d_Cqygyq3Mj1gJe19kpYU",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "preload",
        as: "style",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Urbanist:wght@500;600;700;800&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Urbanist:wght@500;600;700;800&display=swap",
      },

    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Aegis",
          applicationCategory: "SecurityApplication",
          operatingSystem: "Web",
          description:
            "Zero-knowledge, end-to-end encrypted TOTP authenticator. Your passphrase never leaves your device.",
          url: "https://aegis-v2.flinkeo.online/",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // `suppressHydrationWarning` is required on <html> and <body> because the
  // pre-hydration boot scripts below intentionally mutate them before React
  // hydrates: THEME_INIT_SCRIPT toggles the `dark` class + `style.colorScheme`
  // on <html>, and LOCALE_INIT_SCRIPT rewrites `<html lang>`. Without this,
  // React logs a noisy hydration-mismatch warning on every page load and
  // after every locale/theme change that navigates.
  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        {/* Applied pre-hydration so first paint matches the user's saved
            theme + locale — prevents a light-mode flash and mismatched
            <html lang> before React mounts. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
        />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}


function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    // Idempotent theme re-apply + subscribe to OS `prefers-color-scheme`
    // changes so a "system" user follows their OS without a reload.
    return initTheme();
  }, []);

  useEffect(() => {
    // Idempotent locale re-apply once React is mounted — the pre-hydration
    // script already set <html lang> so this just aligns the `i18n` runtime.
    initLocale();
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      import("@/integrations/supabase/client"),
      import("@/lib/vault-session"),
      import("@/lib/vault-cache"),
    ]).then(([{ supabase }, { lockVault }, { clearVaultCache }]) => {
      if (!mounted) return;

      // Pull the user's saved theme + locale preferences from `profiles`
      // so a fresh sign-in on a new device matches their choices.
      const syncPrefsFromProfile = async () => {
        try {
          const { data: sess } = await supabase.auth.getSession();
          const uid = sess.session?.user?.id;
          if (!uid) return;
          const { data } = await supabase
            .from("profiles")
            .select("theme_pref, locale")
            .eq("id", uid)
            .maybeSingle();
          const themePref = data?.theme_pref as ThemePref | undefined;
          if (themePref === "system" || themePref === "light" || themePref === "dark") {
            setThemePref(themePref);
          }
          const localePref = data?.locale as LocalePref | undefined;
          if (localePref) setLocalePref(localePref);
        } catch {
          // Offline / RLS blocked — the local preference stays authoritative.
        }
      };
      void syncPrefsFromProfile();

      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
        if (event === "SIGNED_OUT") {
          lockVault();
          void clearVaultCache();
        } else {
          void syncPrefsFromProfile();
        }
        router.invalidate();
        if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      });
      // Store for cleanup
      (window as unknown as { __aegis_auth_sub?: { unsubscribe: () => void } }).__aegis_auth_sub =
        data.subscription;
    });
    return () => {
      mounted = false;
      const sub = (window as unknown as { __aegis_auth_sub?: { unsubscribe: () => void } })
        .__aegis_auth_sub;
      sub?.unsubscribe();
    };
  }, [queryClient, router]);

  useEffect(() => {
    // Guarded PWA service-worker registration. The wrapper refuses to
    // register in dev, iframes, Lovable preview hosts, and when the URL
    // carries `?sw=off` — see src/lib/pwa-register.ts.
    void import("@/lib/pwa-register").then(({ registerAegisServiceWorker }) =>
      registerAegisServiceWorker(),
    );
    // Real-User Monitoring — LCP/INP/CLS collector, sampled at 10%.
    void import("@/lib/rum").then(({ initRum }) => initRum());
  }, []);

  return (
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        {/* `richColors` intentionally omitted — sonner's built-in bright
            green/red overrides our Aegis-tinted variants. See
            `src/components/ui/sonner.tsx` for the palette-matched styling. */}
        <Toaster position="top-center" closeButton />
      </QueryClientProvider>
    </I18nProvider>
  );
}
