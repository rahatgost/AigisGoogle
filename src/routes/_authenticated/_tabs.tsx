import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AegisScreen } from "@/components/aegis/chrome";
import { BottomTabs } from "@/components/aegis/BottomTabs";

/**
 * Pathless layout shared by all bottom-tab destinations (Vault, Security,
 * Profile). Renders the AegisScreen shell + BottomTabs once, so switching
 * tabs only swaps the <Outlet /> — the backdrop, brand bar and tab bar
 * never re-mount, and their intro animations never replay.
 */
export const Route = createFileRoute("/_authenticated/_tabs")({
  component: TabsLayout,
});

function TabsLayout() {
  return (
    <AegisScreen>
      <div
        className="-mx-6 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-[calc(112px+env(safe-area-inset-bottom))]"
        style={{ WebkitOverflowScrolling: "touch" as never }}
      >
        <Outlet />
      </div>
      <BottomTabs />
    </AegisScreen>
  );
}
