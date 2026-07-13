import { useNavigate } from "@tanstack/react-router";
import { Lock, LogIn } from "lucide-react";
import { BORDER, CHARCOAL, CREAM_SOFT, MUTED } from "@/components/aegis/chrome";

/**
 * Renders a "Sign in to unlock" placeholder for cloud-only features
 * when the app is running in local-only guest mode.
 */
export function LockedSection({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const navigate = useNavigate();
  return (
    <div
      className="flex items-start gap-3 rounded-[14px] p-4"
      style={{
        background: CREAM_SOFT,
        border: `1px solid ${BORDER}`,
      }}
    >
      <div
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full"
        style={{ background: "rgba(0,0,0,0.06)", color: CHARCOAL }}
      >
        <Lock className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium" style={{ color: CHARCOAL }}>
          {title}
        </div>
        {description && (
          <div className="mt-0.5 text-[12.5px] leading-snug" style={{ color: MUTED }}>
            {description}
          </div>
        )}
        <button
          type="button"
          onClick={() => navigate({ to: "/auth" })}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-opacity hover:opacity-90"
          style={{ background: CHARCOAL, color: CREAM_SOFT }}
        >
          <LogIn className="h-3.5 w-3.5" />
          Sign in to unlock
        </button>
      </div>
    </div>
  );
}
