---
trigger: always_on
description: Enforce Angular Material-first UI patterns and theme consistency.
---

# Material Design Strict Enforcement

## Scope
This always-on rule applies to frontend UI changes.

## Core Principles
1. Avoid global utility class sprawl.
2. Use plain Angular Material components for controls before adding custom UI. For example, use `mat-button-toggle-group` for segmented choices, `mat-icon-button` for icon actions, `mat-slide-toggle` or `mat-checkbox` for booleans, `mat-slider` for numeric ranges, `mat-select` or `mat-menu` for option sets, and `mat-tab-group` for tabs.
3. Use theme tokens (`--mat-sys-*`) for colors and typography.
4. Refactor custom styles that replicate Material primitives.
5. Keep component CSS to layout and spacing around Material controls; do not override Material internals with `::ng-deep` or MDC implementation classes unless there is a documented exception.

## Allowed Custom CSS
- Component-level classes for semantic structure, layout, and documented states.
- Avoid hardcoded colors, custom shadows, and one-off visual systems.
- Do not introduce custom-styled controls, tabs, cards, badges, or decorative surfaces when Angular Material or an existing app pattern already covers the need.
- When custom CSS is necessary, keep it consistent with nearby app layouts and limit it to structure, density, spacing, and responsive behavior.
- Prefer reusing existing shared app classes and Material theme tokens over inventing new component-specific visual language.

## Dialogs and Overlays
- Do not add custom `panelClass` unless there is a documented exception.
- Prefer the global dialog container conventions.
- For `mat-menu`, use Angular Material's public menu class API deliberately: classes on `<mat-menu>` are applied to the menu panel, while `overlayPanelClass` targets the CDK overlay pane. App-styled menus should include the shared `qs-menu-panel` class on `<mat-menu>` so they inherit the same surface, radius, scrolling, and sizing as the rest of the app.

## Checklist
- Standard Material component used where available
- No new global utility classes
- Colors and text styles use Material tokens
