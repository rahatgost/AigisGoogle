---
name: ui-ux-pro-max
description: AI-powered design intelligence for UI/UX work. Trigger for tasks involving visual design decisions, component design, color/typography/style selection, layout & responsive behavior, accessibility, motion, charts, or reviewing/improving existing UI. Skip for pure backend, API, DB, DevOps, or non-visual work. Ships 84 UI styles, 161 color palettes, 73 font pairings, 99 UX guidelines, and 25 chart types across 17 tech stacks, queryable via bundled Python scripts.
---

# UI/UX Pro Max

Vendored from https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (MIT — see `LICENSE`).

## When to apply

Use whenever a task changes how something **looks, feels, moves, or is interacted with**:

- New page/screen (landing, dashboard, admin, SaaS, mobile)
- New or refactored component (button, modal, form, table, chart, nav)
- Choosing style / color palette / typography / spacing / layout
- Reviewing UI for UX, accessibility, or visual consistency
- Navigation, motion, or responsive behavior
- Product-level design decisions (style, hierarchy, brand tone)

Skip for pure backend/API/DB/DevOps work.

## Priorities (apply in this order)

1. Accessibility (contrast ≥4.5:1, alt text, keyboard nav, aria labels)
2. Touch & interaction (≥44×44px targets, ≥8px spacing, loading feedback)
3. Performance (WebP/AVIF, lazy loading, reserve space — CLS <0.1)
4. Style selection (match product; consistent; SVG icons, no emoji)
5. Layout & responsive (mobile-first, no horizontal scroll, no disabled zoom)
6. Typography & color (base 16px, line-height 1.5, semantic tokens — no raw hex in components)
7. Animation (150–300ms, meaningful, respect reduced-motion)
8. Forms & feedback (visible labels, inline errors, progressive disclosure)
9. Navigation (predictable back, bottom nav ≤5, deep links)
10. Charts & data (never rely on color alone)

## Workflow

1. **Classify the task** — new page, new component, style/color/font pick, review, bug fix, or optimization.
2. **Check the quick reference** — `references/templates/quick-reference.md` has the full priority checklist and anti-patterns.
3. **Query the data** — use the bundled Python scripts to pull concrete guidance instead of guessing:

   ```bash
   # Copy scripts + data out of the read-only skill mount into /tmp first
   mkdir -p /tmp/uupm && cp -r knowledge://skill/ui-ux-pro-max/scripts /tmp/uupm/ \
     && cp -r knowledge://skill/ui-ux-pro-max/references/data /tmp/uupm/data

   # Search a domain (style | color | typography | ux | chart | product | icon | motion)
   python3 /tmp/uupm/scripts/search.py --domain style "fintech dashboard"
   python3 /tmp/uupm/scripts/search.py --domain color "warm minimal"
   python3 /tmp/uupm/scripts/search.py --domain typography "sora + inter"

   # Build a full design system recommendation
   python3 /tmp/uupm/scripts/design_system.py --product "personal finance app" --style "warm minimal"
   ```

   Data lives in `references/data/*.csv` (colors, styles, typography, ux-guidelines, charts, icons, motion, products, app-interface, landing, react-performance, ui-reasoning) plus per-stack details under `references/data/stacks/`.

4. **Apply, then verify** — implement using the returned tokens/guidelines, then re-check against the priority list above (a11y first). For visual changes, screenshot with the browser tool and confirm.

## Bundled files

- `SKILL.md` — this file
- `LICENSE` — MIT license, must remain with vendored copy
- `scripts/search.py` — domain search over the CSV data
- `scripts/design_system.py` — end-to-end design system recommender
- `scripts/core.py` — shared helpers (loaded by the other two)
- `references/data/*.csv` + `references/data/stacks/` — the underlying knowledge base
- `references/templates/quick-reference.md` — full priority + anti-pattern checklist
- `references/templates/skill-content.md` — extended workflow reference

## House rules (project-specific)

- Never hardcode Tailwind color utilities (`text-white`, `bg-[#...]`) — always semantic tokens from `src/styles.css`.
- Reject default "AI look" (Inter + purple/indigo gradient on white) unless the user asks for it.
- Use `imagegen--generate_image` for any raster art needed; do not pull external image URLs at runtime.
