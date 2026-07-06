import { createFileRoute, redirect } from "@tanstack/react-router";

// Devices management is now inline in the Security tab. Keep this URL as a
// permanent redirect so old bookmarks/links still land in the right place.
export const Route = createFileRoute("/_authenticated/devices")({
  beforeLoad: () => {
    throw redirect({ to: "/security" });
  },
  component: () => null,
});
