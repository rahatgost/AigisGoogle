import { Link } from "@tanstack/react-router";
import { ShieldAlert, Check, ArrowRight } from "lucide-react";

/**
 * Rich upgrade card shown to Free users wherever breach monitoring is
 * gated. Lists the concrete Pro benefits + price so the ask is clear
 * without leaving the current screen. Deep-links to `/profile#plan`
 * so the plan comparison sheet auto-opens on arrival.
 */
export function BreachUpgradeCard() {
  const perks = [
    "Anonymous k-anonymity checks against Have I Been Pwned",
    "Alerts when an issuer you use appears in a breach corpus",
    "Auto encrypted cloud backup + 30-day history",
    "500 accounts, unlimited devices & tags",
  ];

  return (
    <div
      className="rounded-[14px] p-4"
      style={{
        background: "var(--aegis-cream-soft)",
        border: "1px solid var(--aegis-border)",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{
            background: "var(--aegis-ink)",
            color: "var(--aegis-cream-soft)",
          }}
        >
          <ShieldAlert className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-[14px]"
              style={{ color: "var(--aegis-ink)", fontWeight: 600 }}
            >
              Breach monitoring
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] uppercase"
              style={{
                background: "var(--aegis-ink)",
                color: "var(--aegis-cream-soft)",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              Pro
            </span>
          </div>
          <div
            className="mt-1 text-[12.5px] leading-[1.5]"
            style={{ color: "var(--aegis-muted)" }}
          >
            Free plan doesn’t include breach checks. Upgrade to Pro to see if
            any issuer in your vault has appeared in a known breach.
          </div>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {perks.map((p) => (
          <li
            key={p}
            className="flex items-start gap-2 text-[12.5px] leading-[1.45]"
            style={{ color: "var(--aegis-ink)" }}
          >
            <Check
              className="mt-[2px] h-3.5 w-3.5 shrink-0"
              strokeWidth={2.2}
              style={{ color: "var(--aegis-ink)" }}
            />
            <span>{p}</span>
          </li>
        ))}
      </ul>

      <div
        className="mt-3 flex items-center justify-between gap-3 rounded-[10px] px-3 py-2"
        style={{ background: "var(--aegis-cream)" }}
      >
        <div className="text-[12.5px]" style={{ color: "var(--aegis-ink)" }}>
          <span style={{ fontWeight: 600 }}>Pro — $2.99/mo</span>
          <span style={{ color: "var(--aegis-muted)" }}> · Family $4.99</span>
        </div>
        <Link
          to="/profile"
          hash="plan"
          className="inline-flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[12.5px]"
          style={{
            background: "var(--aegis-ink)",
            color: "var(--aegis-cream-soft)",
            fontWeight: 500,
          }}
        >
          Upgrade
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}
