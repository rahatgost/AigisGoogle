import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Small inline card shown to Free users when they hit a gated feature.
 * Deep-links to /profile with a hash so the plan sheet can auto-open.
 */
export function UpgradePrompt({
  title,
  body,
  tier = "Pro",
  icon,
  compact = false,
}: {
  title: string;
  body: string;
  tier?: "Pro" | "Family";
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-[12px] p-3"
      style={{
        background: "var(--aegis-cream-soft)",
        border: "1px solid var(--aegis-border)",
      }}
    >
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{
          background: "var(--aegis-ink)",
          color: "var(--aegis-cream-soft)",
        }}
      >
        {icon ?? <Sparkles className="h-4 w-4" strokeWidth={1.8} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="text-[13.5px]"
            style={{ color: "var(--aegis-ink)", fontWeight: 500 }}
          >
            {title}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
            style={{
              background: "var(--aegis-ink)",
              color: "var(--aegis-cream-soft)",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            {tier}
          </span>
        </div>
        {!compact && (
          <div
            className="mt-1 text-[12.5px] leading-[1.45]"
            style={{ color: "var(--aegis-muted)" }}
          >
            {body}
          </div>
        )}
        <Link
          to="/profile"
          hash="plan"
          className="mt-2 inline-flex items-center gap-1 text-[12.5px] underline underline-offset-[3px]"
          style={{ color: "var(--aegis-ink)" }}
        >
          See plans
          <ArrowRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}
