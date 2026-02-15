---
trigger: model_decision
description: Use for responsive design decisions and media-query standardization.
---

Use this rule when changing responsive layout behavior.

## Apply This Rule
- CSS/SCSS media queries
- Responsive TypeScript logic (`BreakpointObserver` or constants)

## Do Not Apply This Rule
- Non-responsive UI changes

## Standard Breakpoints

Use these project breakpoint values only:

| Name | Max-Width | Min-Width | Use Case |
|------|-----------|-----------|----------|
| XSmall | 599px | - | Phones |
| Small | 959px | 600px | Tablets |
| Medium | 1279px | 960px | Laptops |
| Large | 1919px | 1280px | Desktops |

## Rules
1. Do not introduce arbitrary breakpoints.
2. Import constants from `@shared/constants/breakpoints` in TypeScript.
3. Keep CSS media queries aligned to the same values.

## Source of Truth
- `src/app/constants/breakpoints.ts`
- `src/styles/_breakpoints.scss`
