import { createFileRoute, Link } from "@tanstack/react-router";
import { Monitor, Globe, ShieldCheck, Copy, KeyRound } from "lucide-react";

const URL = "https://aegis-syed.lovable.app/blog/google-authenticator-for-pc";
const TITLE = "How to Use Google Authenticator on PC and Mac (2026)";
const DESCRIPTION =
  "Google Authenticator is mobile-only. Here's how to get your 2FA codes on PC, Mac, and any browser — securely, without waiting for the official desktop app.";

export const Route = createFileRoute("/blog/google-authenticator-for-pc")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: URL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: TITLE,
          description: DESCRIPTION,
          author: { "@type": "Organization", name: "Aegis" },
          publisher: { "@type": "Organization", name: "Aegis" },
          mainEntityOfPage: URL,
          datePublished: "2026-07-06",
          dateModified: "2026-07-06",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "Is there a Google Authenticator app for PC or Mac?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "No. Google Authenticator is officially mobile-only (iOS and Android). To get your 2FA codes on a computer, use a compatible authenticator like Aegis that runs in any browser and imports the same TOTP secrets.",
              },
            },
            {
              "@type": "Question",
              name: "Can I use Google Authenticator online in a browser?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Google does not offer a browser version. The safest way to get Google Authenticator codes online is to import your TOTP secrets into a zero-knowledge web authenticator such as Aegis, which computes the same RFC 6238 codes locally in your browser.",
              },
            },
            {
              "@type": "Question",
              name: "Is it safe to use a web-based authenticator?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "It depends on the provider. Aegis is zero-knowledge and end-to-end encrypted — your secrets are encrypted on your device with a key derived from your passphrase, so the server only ever stores ciphertext. Avoid web authenticators that store secrets in plaintext or that lack end-to-end encryption.",
              },
            },
          ],
        }),
      },
    ],
  }),
  component: GuidePage,
});

function GuidePage() {
  return (
    <div
      className="min-h-screen"
      style={{
        background: "var(--aegis-cream)",
        color: "var(--aegis-ink)",
        fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <header className="border-b" style={{ borderColor: "rgb(var(--aegis-ink-rgb) / 0.08)" }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link to="/" className="text-[15px] font-semibold tracking-tight">
            Aegis
          </Link>
          <Link
            to="/auth"
            className="rounded-full px-4 py-2 text-[13px] font-semibold"
            style={{ background: "var(--aegis-ink)", color: "var(--aegis-cream)" }}
          >
            Get Aegis free
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <p
          className="mb-4 text-[11px] uppercase"
          style={{
            color: "var(--aegis-muted)",
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.22em",
          }}
        >
          Guide · 5 min read
        </p>
        <h1
          className="text-[38px] leading-[1.1] tracking-tight sm:text-[46px]"
          style={{ fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          How to use Google Authenticator on PC, Mac, and browser (2026)
        </h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-relaxed" style={{ color: "var(--aegis-muted)" }}>
          Google Authenticator is a mobile-only app — there is no official PC, Mac, or browser
          version. If you want to use <strong>Google Authenticator online</strong> so your 2FA
          codes are one keystroke away on your computer, you need a compatible authenticator
          that can compute the same TOTP codes in a browser. This guide shows the safe way to
          do it.
        </p>

        <section className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight">The short answer</h2>
          <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--aegis-muted)" }}>
            TOTP is an open standard (RFC 6238). Every authenticator app — Google Authenticator,
            Authy, 1Password, Aegis — computes the same 6-digit code from the same shared
            secret. That means you can move your secrets into a web-first authenticator like
            <strong> Aegis</strong> and read Google Authenticator codes on any desktop, laptop,
            or browser, without waiting for Google to ship an app that doesn't exist.
          </p>
        </section>

        <section className="mt-14 space-y-10">
          <Block
            icon={<Monitor className="h-5 w-5" />}
            title="1. Export your Google Authenticator accounts"
          >
            On your phone, open Google Authenticator → tap the menu → <strong>Transfer
            accounts</strong> → <strong>Export accounts</strong>. Choose the accounts to move
            and Google Authenticator generates one or more QR codes. Keep the phone on this
            screen — you'll scan the QRs from your computer in the next step.
          </Block>

          <Block
            icon={<Globe className="h-5 w-5" />}
            title="2. Open Aegis in your browser on PC or Mac"
          >
            Sign in to Aegis on the computer you want your 2FA codes on. Aegis runs in any
            modern browser (Chrome, Edge, Safari, Firefox, Arc) and installs as a PWA if you
            want a proper desktop app icon. No store install, no wait list, no companion
            device required to bootstrap.
          </Block>

          <Block
            icon={<KeyRound className="h-5 w-5" />}
            title="3. Import your Google Authenticator export"
          >
            In Aegis, choose <strong>Import → Google Authenticator</strong> and either scan
            the export QRs with your webcam or paste the <code>otpauth-migration://</code> URI
            from a QR-decoding tool. Aegis parses the payload, decrypts each entry locally,
            and adds every account to your encrypted vault. Your 6-digit codes start rolling
            immediately.
          </Block>

          <Block
            icon={<Copy className="h-5 w-5" />}
            title="4. Copy codes with one keystroke"
          >
            The whole point of getting Google Authenticator on your computer is to stop fishing
            for your phone every time you sign in to work. In Aegis, hit <kbd>/</kbd> to
            search, arrow to the account, and press <kbd>Enter</kbd> to copy the current
            code. Paste, done.
          </Block>

          <Block
            icon={<ShieldCheck className="h-5 w-5" />}
            title="5. Keep it zero-knowledge"
          >
            A web authenticator only makes sense if the provider genuinely can't read your
            secrets. Aegis is zero-knowledge and end-to-end encrypted: your vault is encrypted
            on your device with a key derived from your passphrase, and the server only stores
            ciphertext. If a random web-based authenticator can email you your codes — walk
            away. That means they have them.
          </Block>
        </section>

        <section className="mt-14">
          <h2 className="text-[22px] font-semibold tracking-tight">
            Why not just install Google Authenticator on desktop?
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "var(--aegis-muted)" }}>
            Because there is no official desktop version. Third-party sites that promise a
            &ldquo;Google Authenticator for Windows&rdquo; download are almost always
            re-skinned TOTP apps at best, and malware at worst. Since TOTP is an open
            standard, the safe path is to use a trustworthy authenticator that already
            supports the browser natively — that's exactly what Aegis is for.
          </p>
        </section>

        <section className="mt-14">
          <h2 className="text-[22px] font-semibold tracking-tight">
            Web authenticators to avoid
          </h2>
          <ul
            className="mt-4 space-y-3 text-[14.5px] leading-relaxed"
            style={{ color: "var(--aegis-muted)" }}
          >
            <li>
              <strong>Any site that stores secrets unencrypted.</strong> If they can display
              your code on a fresh device without a passphrase, they hold the key too.
            </li>
            <li>
              <strong>&ldquo;Online TOTP&rdquo; generators that paste a secret into a form.</strong>{" "}
              These are handy for a one-off test, terrible as a daily authenticator — the
              secret sits in your browser history and the server logs.
            </li>
            <li>
              <strong>Browser extensions from unknown publishers.</strong> An extension has full
              access to every page you visit. Only install ones you'd trust with your bank
              login.
            </li>
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="text-[22px] font-semibold tracking-tight">
            Get Google Authenticator codes on your computer now
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "var(--aegis-muted)" }}>
            Sign in to Aegis, import your Google Authenticator accounts once, and your 2FA
            codes are on every device you sign in on — PC, Mac, tablet, phone — encrypted
            end-to-end.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="rounded-full px-5 py-3 text-[14px] font-semibold"
              style={{ background: "var(--aegis-ink)", color: "var(--aegis-cream)" }}
            >
              Open Aegis on desktop
            </Link>
            <Link
              to="/blog/aegis-vs-google-authenticator"
              className="rounded-full border px-5 py-3 text-[14px] font-semibold"
              style={{ borderColor: "rgb(var(--aegis-ink-rgb) / 0.15)", color: "var(--aegis-ink)" }}
            >
              Compare with Google Authenticator
            </Link>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-[22px] font-semibold tracking-tight">FAQ</h2>
          <dl className="mt-4 space-y-5 text-[14.5px]" style={{ color: "var(--aegis-muted)" }}>
            <Faq
              q="Is there a Google Authenticator app for PC or Mac?"
              a="No. Google Authenticator is officially mobile-only. To get the same 2FA codes on a computer, import your TOTP secrets into a compatible web authenticator like Aegis."
            />
            <Faq
              q="Can I use Google Authenticator online in a browser?"
              a="Google does not offer a browser version. The safest way is to import your accounts into a zero-knowledge web authenticator that computes the same RFC 6238 codes locally in your browser."
            />
            <Faq
              q="Is a web-based authenticator safe?"
              a="Only if it is end-to-end encrypted and zero-knowledge. Aegis encrypts your vault on your device with a key derived from your passphrase, so the provider only ever sees ciphertext."
            />
            <Faq
              q="Do I have to remove Google Authenticator from my phone?"
              a="No. You can keep both. TOTP codes are deterministic, so any authenticator holding the same secret shows the same 6 digits."
            />
          </dl>
        </section>
      </main>

      <footer
        className="border-t"
        style={{ borderColor: "rgb(var(--aegis-ink-rgb) / 0.08)", color: "var(--aegis-muted)" }}
      >
        <div className="mx-auto max-w-3xl px-6 py-8 text-[12px]">
          © {new Date().getFullYear()} Aegis · Google Authenticator on PC, Mac, and browser
        </div>
      </footer>
    </div>
  );
}

function Block({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-full"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: "var(--aegis-ink)" }}
        >
          {icon}
        </span>
        <h3 className="text-[17px] font-semibold tracking-tight">{title}</h3>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--aegis-muted)" }}>
        {children}
      </p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-semibold" style={{ color: "var(--aegis-ink)" }}>
        {q}
      </dt>
      <dd className="mt-1">{a}</dd>
    </div>
  );
}
