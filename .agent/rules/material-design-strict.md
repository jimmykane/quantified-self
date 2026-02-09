---
trigger: always_on
description: Enforce Angular Material-first UI patterns and theme consistency.
---

# Material Design Strict Enforcement

## Scope
This always-on rule applies to frontend UI changes.

## Core Principles
1. Avoid global utility class sprawl.
2. Prefer native Angular Material components over custom structural markup.
3. Use theme tokens (`--mat-sys-*`) for colors and typography.
4. Refactor custom styles that replicate Material primitives.

## Allowed Custom CSS
- Component-level classes for semantic structure, layout, and documented states.
- Avoid hardcoded colors, custom shadows, and one-off visual systems.

## Dialogs and Overlays
- Do not add custom `panelClass` unless there is a documented exception.
- Prefer the global dialog container conventions.

## Checklist
- Standard Material component used where available
- No new global utility classes
- Colors and text styles use Material tokens
