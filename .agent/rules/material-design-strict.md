---
trigger: always_on
description: Enforce Angular Material-first UI patterns and theme consistency.
---

# Material Design Strict Enforcement

## Scope
This always-on rule applies to frontend UI changes.

## Core Principles
1. Avoid global utility class sprawl.
2. Use plain Angular Material components for controls before adding custom UI. For example, use `mat-button-toggle-group` for segmented choices, `mat-icon-button` for icon actions, `mat-slide-toggle` or `mat-checkbox` for booleans, `mat-slider` for numeric ranges, `mat-select` or `mat-menu` for option sets, `mat-tab-group` for tabs, and `mat-expansion-panel` for collapsible application surfaces instead of custom-styled `details` controls.
3. Use theme tokens (`--mat-sys-*`) for colors and typography.
4. Refactor custom styles that replicate Material primitives.
5. Keep component CSS to layout and spacing around Material controls; do not override Material internals with `::ng-deep` or MDC implementation classes unless there is a documented exception.

## Allowed Custom CSS
- Component-level classes for semantic structure, layout, and documented states.
- Avoid hardcoded colors, custom shadows, and one-off visual systems.
- Do not introduce custom-styled controls, tabs, cards, badges, or decorative surfaces when Angular Material or an existing app pattern already covers the need.
- When custom CSS is necessary, keep it consistent with nearby app layouts and limit it to structure, density, spacing, and responsive behavior.
- Prefer reusing existing shared app classes and Material theme tokens over inventing new component-specific visual language.

## Data Visualization
- Use the shared ECharts loader, host controller, theme, tooltip, resize, and mobile-interaction helpers for product charts.
- Do not hand-roll SVG or canvas charts, axes, paths, bars, points, tooltips, or chart interaction when ECharts can represent the visualization.
- Reuse an existing normalized app chart when it already owns the domain model, such as Sleep, instead of creating a second chart implementation.
- Any exception must be documented next to the implementation with the concrete accessibility or rendering constraint that prevents ECharts use.

## Dialogs and Overlays
- Do not add custom `panelClass` unless there is a documented exception.
- Prefer the global dialog container conventions.
- For `mat-menu`, use Angular Material's public menu class API deliberately: classes on `<mat-menu>` are applied to the menu panel, while `overlayPanelClass` targets the CDK overlay pane. App-styled menus should include the shared `qs-menu-panel` class on `<mat-menu>` so they inherit the same surface, radius, scrolling, and sizing as the rest of the app.

## Async Button Content Alignment

- When a Material button wraps an icon/spinner and text in an app-owned content row, use `display: flex`,
  `align-items: center`, and `justify-content: center` on that row. Preserve the same row and equal icon/spinner boxes
  across idle and pending states. Leave normal direct-icon Material buttons alone.
- Do not assume an `inline-flex` row is centered just because it has `align-items: center`. Inside Material's label,
  the row still participates in baseline layout; the surrounding line box reserves descender space and can lift the
  entire row above the button center. Inner alignment centers children, not the row within its parent.
- Fix the app-owned row's formatting context, not Material's internal label classes. Do not compensate with
  transforms, negative margins, or arbitrary line-height/padding adjustments.
- Verify both levels: icon/spinner versus text, then the entire content row versus the button. Use browser bounding
  boxes and a visual check at desktop and mobile widths; equal child centers alone do not prove button alignment.
  Cover idle and disabled/pending rendering with a mocked operation, never a production mutation solely to show a
  spinner. JSDOM tests can guard the markup/CSS contract but cannot establish pixel alignment; report any unverified
  browser state explicitly.

## Checklist
- Standard Material component used where available
- Async UI actions show an explicit loading state on or next to the triggering control, with layout kept stable while the action is pending
- Icon+text Material buttons keep icons, spinners, and labels vertically centered with one explicit center-aligned content row and normalized icon/spinner dimensions
- No new global utility classes
- Colors and text styles use Material tokens
