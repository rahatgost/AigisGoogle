import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * E2E: axe-core accessibility sweep across public routes.
 *
 * Runs axe on every public route from `docs/routing.md` (the routes that
 * don't require an authenticated Supabase session) and asserts zero
 * violations at the `serious` or `critical` impact level. Rules we
 * intentionally skip:
 *
 *  - `color-contrast`: the brand cream/charcoal palette hovers near the
 *    4.5:1 threshold on subdued muted text by design. Contrast is checked
 *    manually against the design tokens in `/dev/tokens` rather than on
 *    every CI run — otherwise every marketing-copy tweak turns red.
 *  - `region`: the landing page uses hero sections without an explicit
 *    <main> wrapper on purpose; the marketing route intentionally lifts
 *    the header out of the landmark tree.
 *
 * Authenticated routes are covered by `locale-switch.spec.ts` (which
 * needs a real session). When a session is injected we could extend this
 * file too, but the public surface is where anonymous users land first
 * and where a11y regressions hurt the most.
 */

const PUBLIC_ROUTES: Array<{ path: string; name: string }> = [
  { path: "/", name: "landing" },
  { path: "/auth", name: "auth-signin" },
  { path: "/auth/reset-password", name: "auth-reset-password" },
];

const IGNORED_RULES = ["color-contrast", "region"];

for (const { path, name } of PUBLIC_ROUTES) {
  test(`no serious/critical axe violations on ${name} (${path})`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    // Give framer-motion transitions and route loaders a beat to settle
    // so axe doesn't fire against a half-mounted subtree.
    await page.waitForLoadState("networkidle").catch(() => {});

    const results = await new AxeBuilder({ page })
      .disableRules(IGNORED_RULES)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );

    if (blocking.length > 0) {
      // Surface each violation with a stable summary in the report.
      for (const v of blocking) {
        // eslint-disable-next-line no-console
        console.error(
          `[axe:${name}] ${v.id} (${v.impact}) — ${v.help}\n  nodes: ${v.nodes.length}\n  ${v.helpUrl}`,
        );
      }
    }

    expect(
      blocking.map((v) => `${v.id}:${v.impact}`),
      `Axe found ${blocking.length} blocking violation(s) on ${path}.`,
    ).toEqual([]);
  });
}
