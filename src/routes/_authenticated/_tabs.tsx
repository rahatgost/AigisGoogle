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
      <div className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
      <BottomTabs />
    </AegisScreen>
  );
}
