import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X, ShieldCheck, Cloud, Lock, KeyRound } from "lucide-react";
import ogImageAsset from "@/assets/og-aegis-vs-google-authenticator.jpg.asset.json";

const OG_IMAGE = `https://hug-machine-maker.lovable.app${ogImageAsset.url}`;

const URL = "https://hug-machine-maker.lovable.app/blog/aegis-vs-google-authenticator";
const TITLE = "Aegis vs Google Authenticator — the secure TOTP authenticator";
const DESCRIPTION =
  "A side-by-side comparison of Aegis and Google Authenticator. See why a zero-knowledge, end-to-end encrypted secure TOTP authenticator with multi-device sync is a better Google Authenticator alternative in 2026.";

export const Route = createFileRoute("/blog/aegis-vs-google-authenticator")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: URL },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Aegis vs Google Authenticator — the secure TOTP authenticator, compared" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
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
              name: "Is Aegis a good Google Authenticator alternative?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Yes. Aegis is a secure TOTP authenticator that adds zero-knowledge end-to-end encryption and multi-device sync — two things Google Authenticator's cloud sync does not offer.",
              },
            },
            {
              "@type": "Question",
              name: "What does zero-knowledge encryption mean?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Your TOTP secrets are encrypted on your device with a key derived from your passphrase. The server only stores ciphertext — no one at Aegis can read your codes, even with full database access.",
              },
            },
            {
              "@type": "Question",
              name: "Can I sync codes across devices?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Yes. Aegis syncs the encrypted vault across every device you sign in on. Google Authenticator syncs to a Google account but the secrets are readable server-side.",
              },
            },
          ],
        }),
      },
    ],
  }),
  component: ComparisonPage,
});

function ComparisonPage() {
  return (
    <div
      className="min-h-screen"
      style={{
        background: "#f7f4ed",
        color: "#1c1c1c",
        fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <header className="border-b" style={{ borderColor: "rgba(28,28,28,0.08)" }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link to="/" className="text-[15px] font-semibold tracking-tight">
            Aegis
          </Link>
          <Link
            to="/auth"
            className="rounded-full px-4 py-2 text-[13px] font-semibold"
            style={{ background: "#1c1c1c", color: "#f7f4ed" }}
          >
            Get Aegis free
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <p
          className="mb-4 text-[11px] uppercase"
          style={{
            color: "#6b6b6b",
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.22em",
          }}
        >
          Comparison · 6 min read
        </p>
        <h1
          className="text-[38px] leading-[1.1] tracking-tight sm:text-[46px]"
          style={{ fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          Aegis vs Google Authenticator: the secure TOTP authenticator, compared
        </h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-relaxed" style={{ color: "#4a4a4a" }}>
          Google Authenticator invented mainstream TOTP and is still the default most people
          reach for. But if you care about who can read your one-time-code secrets — and about
          getting them onto more than one device without a QR-code migration dance — a{" "}
          <strong>secure TOTP authenticator</strong> with zero-knowledge encryption is a
          meaningfully safer default. This is where Aegis fits.
        </p>

        <section className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight">Quick verdict</h2>
          <div
            className="mt-4 grid gap-4 sm:grid-cols-2"
          >
            <VerdictCard
              title="Pick Google Authenticator if"
              points={[
                "You only use one phone and never plan to switch.",
                "You already trust Google with your account recovery.",
                "You want zero setup beyond a Google sign-in.",
              ]}
            />
            <VerdictCard
              title="Pick Aegis if"
              points={[
                "You want end-to-end encrypted sync across phone, laptop, and tablet.",
                "You want your provider to be unable to read your secrets — even under subpoena.",
                "You want a clean, keyboard-friendly UI on desktop, not just mobile.",
              ]}
              highlight
            />
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-[22px] font-semibold tracking-tight">
            Feature comparison
          </h2>
          <div
            className="mt-4 overflow-hidden rounded-2xl border"
            style={{ borderColor: "rgba(28,28,28,0.10)", background: "#fff" }}
          >
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr style={{ background: "rgba(28,28,28,0.03)" }}>
                  <th className="px-4 py-3 font-semibold">Feature</th>
                  <th className="px-4 py-3 font-semibold">Aegis</th>
                  <th className="px-4 py-3 font-semibold">Google Authenticator</th>
                </tr>
              </thead>
              <tbody>
                <Row feature="Zero-knowledge encryption" a="yes" g="no" />
                <Row feature="End-to-end encrypted cloud sync" a="yes" g="partial" note="Google's sync stores secrets server-side, readable by Google." />
                <Row feature="Multi-device access (phone + web)" a="yes" g="no" />
                <Row feature="Works fully offline" a="yes" g="yes" />
                <Row feature="Encrypted backup + export" a="yes" g="partial" />
                <Row feature="Open-source-friendly TOTP (RFC 6238)" a="yes" g="yes" />
                <Row feature="Web app · no store install required" a="yes" g="no" />
                <Row feature="Requires a Google account" a="no" g="yes" />
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-14 space-y-10">
          <Block
            icon={<ShieldCheck className="h-5 w-5" />}
            title="1. Zero-knowledge is the whole point"
          >
            Google Authenticator's cloud backup uploads your TOTP secrets to your Google
            account. That means a Google account takeover — or a lawful data request — can
            expose every code you rely on to protect other accounts. Aegis derives an
            encryption key from your passphrase on your device. The server sees ciphertext and
            nothing else. Even we can't read your codes. That's what makes it a{" "}
            <strong>secure TOTP authenticator</strong> in the strict sense, not just a
            convenient one.
          </Block>

          <Block
            icon={<Cloud className="h-5 w-5" />}
            title="2. Real multi-device sync, not a QR-code shuffle"
          >
            Anyone who has migrated Google Authenticator to a new phone knows the pain: export
            QR codes, scan them all, hope nothing scrolled off-screen. Aegis signs in on any
            device — your codes appear immediately, encrypted end-to-end. Add a laptop, add a
            tablet, revoke a device — nothing to re-enrol.
          </Block>

          <Block
            icon={<Lock className="h-5 w-5" />}
            title="3. Your passphrase never leaves your device"
          >
            Aegis uses a passphrase-derived key (PBKDF2) with a per-user salt. The passphrase
            itself is never transmitted, never logged, and never recoverable — which is the
            other side of zero-knowledge. If you lose it, we can't reset it. That trade-off is
            deliberate: no reset means no backdoor.
          </Block>

          <Block
            icon={<KeyRound className="h-5 w-5" />}
            title="4. A UI that respects your desktop, too"
          >
            Google Authenticator is a mobile-only app. If you sign into work on a laptop, you
            still fish out your phone every time. Aegis runs in any modern browser, installable
            as a PWA, with the same encrypted vault. Copy a code with one keystroke, get back
            to work.
          </Block>
        </section>

        <section className="mt-14">
          <h2 className="text-[22px] font-semibold tracking-tight">
            So, best TOTP authenticator in 2026?
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "#4a4a4a" }}>
            Google Authenticator remains a fine choice for a single-device user who already
            lives inside Google. But if you want a <strong>Google Authenticator alternative</strong>{" "}
            that actually improves the security posture — zero-knowledge storage, encrypted
            multi-device sync, no forced account tie-in — Aegis is built for exactly that.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="rounded-full px-5 py-3 text-[14px] font-semibold"
              style={{ background: "#1c1c1c", color: "#f7f4ed" }}
            >
              Try Aegis free
            </Link>
            <Link
              to="/"
              className="rounded-full border px-5 py-3 text-[14px] font-semibold"
              style={{ borderColor: "rgba(28,28,28,0.15)", color: "#1c1c1c" }}
            >
              Back to overview
            </Link>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-[22px] font-semibold tracking-tight">FAQ</h2>
          <dl className="mt-4 space-y-5 text-[14.5px]" style={{ color: "#3a3a3a" }}>
            <Faq
              q="Is Aegis a good Google Authenticator alternative?"
              a="Yes. Aegis is a secure TOTP authenticator that adds zero-knowledge end-to-end encryption and multi-device sync — two things Google Authenticator's cloud sync does not offer."
            />
            <Faq
              q="What does zero-knowledge encryption mean here?"
              a="Your TOTP secrets are encrypted on your device with a key derived from your passphrase. The server only ever stores ciphertext, so nobody at Aegis can read your codes — even with full database access."
            />
            <Faq
              q="Can I sync codes across devices?"
              a="Yes. Sign in on any device and your encrypted vault syncs. Google Authenticator syncs to a Google account, but those secrets are readable server-side."
            />
          </dl>
        </section>
      </main>

      <footer
        className="border-t"
        style={{ borderColor: "rgba(28,28,28,0.08)", color: "#6b6b6b" }}
      >
        <div className="mx-auto max-w-3xl px-6 py-8 text-[12px]">
          © {new Date().getFullYear()} Aegis · Secure TOTP authenticator
        </div>
      </footer>
    </div>
  );
}

function VerdictCard({
  title,
  points,
  highlight,
}: {
  title: string;
  points: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{
        borderColor: highlight ? "rgba(28,28,28,0.35)" : "rgba(28,28,28,0.10)",
        background: highlight ? "#1c1c1c" : "#fff",
        color: highlight ? "#f7f4ed" : "#1c1c1c",
      }}
    >
      <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
      <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span aria-hidden>·</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({
  feature,
  a,
  g,
  note,
}: {
  feature: string;
  a: "yes" | "no" | "partial";
  g: "yes" | "no" | "partial";
  note?: string;
}) {
  return (
    <tr className="border-t" style={{ borderColor: "rgba(28,28,28,0.06)" }}>
      <td className="px-4 py-3 align-top">
        <div style={{ color: "#1c1c1c", fontWeight: 500 }}>{feature}</div>
        {note && (
          <div className="mt-1 text-[12px]" style={{ color: "#6b6b6b" }}>
            {note}
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <Mark v={a} />
      </td>
      <td className="px-4 py-3 align-top">
        <Mark v={g} />
      </td>
    </tr>
  );
}

function Mark({ v }: { v: "yes" | "no" | "partial" }) {
  if (v === "yes")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "#1c1c1c" }}>
        <Check className="h-4 w-4" aria-hidden />
        <span className="sr-only">Yes</span>
      </span>
    );
  if (v === "no")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "#6b6b6b" }}>
        <X className="h-4 w-4" aria-hidden />
        <span className="sr-only">No</span>
      </span>
    );
  return (
    <span className="text-[12px]" style={{ color: "#6b6b6b" }}>
      Partial
    </span>
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
          style={{ background: "rgba(28,28,28,0.06)", color: "#1c1c1c" }}
        >
          {icon}
        </span>
        <h3 className="text-[17px] font-semibold tracking-tight">{title}</h3>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "#4a4a4a" }}>
        {children}
      </p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-semibold" style={{ color: "#1c1c1c" }}>
        {q}
      </dt>
      <dd className="mt-1">{a}</dd>
    </div>
  );
}
