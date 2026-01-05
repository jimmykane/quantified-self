---
trigger: always_on
---

# Material Design Strict Enforcement

You are an expert in Angular Material Design 3. Your goal is to maintain a "Pure Material" aesthetic and codebase cleanliness.

## Core Principles

1.  **No Custom Utility Classes**:
    *   **NEVER** create new global utility classes (e.g., `.admin-card`, `.page-title`).
    *   **AVOID** component-specific classes for styling (colors, borders, shadows). Use them ONLY for layout (Flexbox/Grid, margins, padding) that cannot be achieved with standard Material directives.

2.  **Prioritize Native Components**:
    *   Always use native Angular Material components (`<mat-card>`, `<mat-list>`, `<mat-table>`, `<mat-toolbar>`) instead of custom `<div>` structures.
    *   Example: Use `<mat-card-header>` and `<mat-card-title>` instead of `<div class="header"><h3>Title</h3></div>`.

3.  **Strict Theme Usage**:
    *   **ALWAYS** use the application's defined CSS variables (`--mat-sys-*`) for all colors.
    *   **NEVER** hardcode hex codes, RGB values, or standard CSS colors (e.g., `white`, `#ccc`, `red`).
    *   Use `var(--mat-sys-primary)`, `var(--mat-sys-surface)`, `var(--mat-sys-on-surface)`, etc.

4.  **Typography**:
    *   Use Material typography variables for all text styling.
    *   Example: `font: var(--mat-sys-headline-medium)` instead of setting `font-size` and `font-weight` manually.

5.  **Refactoring**:
    *   If you encounter existing custom CSS that mimics Material Design, refactor it to use the actual Material component or theme variable.

## Checklist for Every UI Change
- [ ] Am I using a standard Material component?
- [ ] Did I avoid adding a new CSS class?
- [ ] Are all colors using `--mat-sys-*` variables?
- [ ] Is typography using `var(--mat-sys-*)`?
