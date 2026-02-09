---
trigger: model_decision
description: Use for Angular Material component selection, theming, and Material-first UI reviews.
---

Use this rule when implementing or reviewing Angular Material UI.

## Apply This Rule
- Building or refactoring UI components with Angular Material
- Replacing custom UI structures with Material components
- Reviewing theme-token and Material API usage

## Do Not Apply This Rule
- Backend-only, security-only, or testing-only tasks
- Non-UI architecture decisions

## Core Guidance
- Prefer native Material components before creating custom UI wrappers.
- Use Material component structure (`mat-card-header`, `mat-card-title`, etc.) instead of ad-hoc div layouts.
- Keep styles token-based (`--mat-sys-*`) and avoid hardcoded colors.
- Use Material typography tokens for text styles.
- Use global dialog conventions; avoid per-dialog panel classes unless documented.

## Common Component Mapping
- Layout: `MatToolbar`, `MatSidenav`, `MatCard`, `MatDivider`
- Inputs: `MatFormField`, `MatInput`, `MatSelect`, `MatDatepicker`
- Data display: `MatTable`, `MatList`, `MatTree`, `MatIcon`
- Feedback: `MatDialog`, `MatSnackBar`, `MatProgressBar`, `MatSpinner`
- Navigation: `MatMenu`, `MatTabs`, `MatStepper`, `MatPaginator`

## Review Output
- List mismatches between custom UI and available Material components.
- Provide direct replacement suggestions.
- Flag theme-token violations and show compliant alternatives.
