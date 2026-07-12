import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X, ShieldCheck, Cloud, Lock, Monitor } from "lucide-react";

const URL_CANONICAL = "https://aegis-v2.flinkeo.online/blog/aegis-vs-authy";
const TITLE = "Aegis vs Authy — The Authy Alternative After Desktop Sunset";
const DESCRIPTION =
  "Looking for an Authy alternative after the desktop app shutdown? Compare Aegis and Authy: end-to-end encrypted multi-device 2FA sync that works on phone, laptop, and web.";

export const Route = createFileRoute("/blog/aegis-vs-authy")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: URL_CANONICAL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: URL_CANONICAL }],
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
          mainEntityOfPage: URL_CANONICAL,
          datePublished: "2026-07-11",
          dateModified: "2026-07-11",
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
              name: "Is Aegis a good Authy alternative?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Yes. Aegis gives you Authy's multi-device convenience with zero-knowledge end-to-end encryption, and it runs in the browser so it works on the desktop even after Authy shut down its desktop app.",
              },
            },
            {
              "@type": "Question",
              name: "Why did Authy shut down the desktop app?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Twilio, Authy's owner, discontinued the Windows, macOS, and Linux desktop apps in 2024 to consolidate on mobile. That left long-time desktop users looking for a replacement that still works on a laptop.",
              },
            },
            {
              "@type": "Question",
              name: "Can I import my Authy tokens into Aegis?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Authy does not offer a direct export. The reliable path is to re-enrol each 2FA account with Aegis using its recovery / QR-code setup screen. Once added, the code syncs to every device you sign in on.",
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
            letterSpacing: "0.22em",
          }}
        >
          Comparison · 6 min read
        </p>
        <h1
          className="text-[38px] leading-[1.1] tracking-tight sm:text-[46px]"
          style={{ fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          Aegis vs Authy: the best Authy alternative after the desktop sunset
        </h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-relaxed" style={{ color: "var(--aegis-muted)" }}>
          Authy popularised multi-device 2FA — codes on your phone AND your laptop, synced through
          the cloud. Then in 2024, Twilio shut down the Authy desktop app, leaving power users
          scrambling for a replacement. Aegis is built for exactly that gap: an{" "}
          <strong>Authy alternative</strong> that keeps the multi-device sync, adds true
          zero-knowledge encryption, and runs in any modern browser so your laptop is back in
          the loop.
        </p>

        <section className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight">Quick verdict</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <VerdictCard
              title="Stay on Authy if"
              points={[
                "You only use one phone and never signed into Authy Desktop.",
                "You're happy for Twilio to hold the encryption key to your 2FA secrets.",
                "You don't need a browser-based fallback when your phone is missing.",
              ]}
            />
            <VerdictCard
              title="Switch to Aegis if"
              points={[
                "You miss Authy Desktop and want codes on your laptop again.",
                "You want end-to-end encryption where the provider literally cannot read your secrets.",
                "You want an installable web app (PWA) that syncs to phone, tablet, and desktop.",
              ]}
              highlight
            />
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-[22px] font-semibold tracking-tight">Feature comparison</h2>
          <div
            className="mt-4 overflow-hidden rounded-2xl border"
            style={{
              borderColor: "rgb(var(--aegis-ink-rgb) / 0.10)",
              background: "var(--aegis-cream-soft)",
            }}
          >
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr style={{ background: "rgb(var(--aegis-ink-rgb) / 0.03)" }}>
                  <th className="px-4 py-3 font-semibold">Feature</th>
                  <th className="px-4 py-3 font-semibold">Aegis</th>
                  <th className="px-4 py-3 font-semibold">Authy</th>
                </tr>
              </thead>
              <tbody>
                <Row feature="Desktop / web app in 2026" a="yes" g="no" note="Authy Desktop was discontinued in 2024; mobile only." />
                <Row feature="Zero-knowledge end-to-end encryption" a="yes" g="partial" note="Authy encrypts backups with your password, but the provider controls the key material." />
                <Row feature="Multi-device sync (phone + laptop + tablet)" a="yes" g="partial" />
                <Row feature="Works fully offline once codes are loaded" a="yes" g="yes" />
                <Row feature="Requires a phone number to sign up" a="no" g="yes" />
                <Row feature="Installable as a PWA — no store required" a="yes" g="no" />
                <Row feature="Standards-based TOTP (RFC 6238) export" a="yes" g="no" />
                <Row feature="Open sign-in options (email, Google)" a="yes" g="no" />
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-14 space-y-10">
          <Block
            icon={<Monitor className="h-5 w-5" />}
            title="1. Your laptop is back in the loop"
          >
            The Authy desktop shutdown was the biggest single change in mainstream 2FA in years.
            If you signed into work on a laptop, you now fish out your phone every single time.
            Aegis runs in any modern browser, installs as a PWA, and shows the same encrypted
            vault on desktop, tablet, and phone. Copy a code with one keystroke, get back to
            work.
          </Block>

          <Block
            icon={<ShieldCheck className="h-5 w-5" />}
            title="2. Zero-knowledge, not just 'encrypted'"
          >
            Authy encrypts backups using a password you set, but the provider is still involved
            in the key exchange. Aegis derives the encryption key from your passphrase on your
            device, using PBKDF2 with a per-user salt. The server sees ciphertext only — even
            with full database access, no one at Aegis can read your codes.
          </Block>

          <Block
            icon={<Cloud className="h-5 w-5" />}
            title="3. Multi-device sync without the SIM"
          >
            Authy uses your phone number as identity, which means every SIM swap is a support
            ticket. Aegis uses an email address (or Google sign-in) and syncs the encrypted
            vault to every device you authorise. Add a laptop, add a tablet, revoke a lost
            device — nothing to re-enrol.
          </Block>

          <Block
            icon={<Lock className="h-5 w-5" />}
            title="4. A passphrase you own, forever"
          >
            The trade-off of zero-knowledge is deliberate: if you forget your passphrase, no
            one can reset it — because no one else has it. In exchange you get an authenticator
            with no backdoor. For anyone who left Authy over the desktop sunset AND wants a
            stronger security posture, that's the whole point.
          </Block>
        </section>

        <section className="mt-14">
          <h2 className="text-[22px] font-semibold tracking-tight">
            The short version
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "var(--aegis-muted)" }}>
            If you're here because Authy Desktop went away and mobile-only doesn't fit your
            workflow, Aegis is the closest replacement — with a stronger encryption model on
            top. Sign in on your laptop, add your accounts, and your phone stays in your
            pocket unless you want it out.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="rounded-full px-5 py-3 text-[14px] font-semibold"
              style={{ background: "var(--aegis-ink)", color: "var(--aegis-cream)" }}
            >
              Try Aegis free
            </Link>
            <Link
              to="/blog/aegis-vs-google-authenticator"
              className="rounded-full border px-5 py-3 text-[14px] font-semibold"
              style={{ borderColor: "rgb(var(--aegis-ink-rgb) / 0.15)", color: "var(--aegis-ink)" }}
            >
              Also: Aegis vs Google Authenticator
            </Link>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-[22px] font-semibold tracking-tight">FAQ</h2>
          <dl className="mt-4 space-y-5 text-[14.5px]" style={{ color: "var(--aegis-muted)" }}>
            <Faq
              q="Is Aegis a good Authy alternative?"
              a="Yes. Aegis keeps the multi-device convenience Authy was known for, adds zero-knowledge encryption, and — crucially — works in the browser on desktop after Authy shut down its desktop app."
            />
            <Faq
              q="Why did Authy shut down the desktop app?"
              a="Twilio discontinued the Windows, macOS, and Linux desktop apps in 2024 to consolidate on mobile. Long-time desktop users have been looking for a replacement ever since."
            />
            <Faq
              q="Can I import my Authy tokens into Aegis?"
              a="Authy does not offer a direct export. The reliable path is to re-enrol each 2FA account with Aegis using its recovery / QR-code setup screen. Once added, the code syncs to every device you sign in on."
            />
          </dl>
        </section>
      </main>

      <footer
        className="border-t"
        style={{ borderColor: "rgb(var(--aegis-ink-rgb) / 0.08)", color: "var(--aegis-muted)" }}
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
        borderColor: highlight ? "rgb(var(--aegis-ink-rgb) / 0.35)" : "rgb(var(--aegis-ink-rgb) / 0.10)",
        background: highlight ? "var(--aegis-ink)" : "var(--aegis-cream-soft)",
        color: highlight ? "var(--aegis-cream)" : "var(--aegis-ink)",
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
    <tr className="border-t" style={{ borderColor: "rgb(var(--aegis-ink-rgb) / 0.06)" }}>
      <td className="px-4 py-3 align-top">
        <div style={{ color: "var(--aegis-ink)", fontWeight: 500 }}>{feature}</div>
        {note && (
          <div className="mt-1 text-[12px]" style={{ color: "var(--aegis-muted)" }}>
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
      <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--aegis-ink)" }}>
        <Check className="h-4 w-4" aria-hidden />
        <span className="sr-only">Yes</span>
      </span>
    );
  if (v === "no")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--aegis-muted)" }}>
        <X className="h-4 w-4" aria-hidden />
        <span className="sr-only">No</span>
      </span>
    );
  return (
    <span className="text-[12px]" style={{ color: "var(--aegis-muted)" }}>
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
