# Frontend Agent Instructions

Read `/Users/dimitrios/Projects/quantified-self/AGENTS.md` first.

Frontend-only rules:
- `../.agent/rules/rules.md`
- `../.agent/rules/material-design-strict.md`
- Authenticated product workspace routes, except Settings, must apply the shared `qs-workspace-page` class to their route
  root. Do not add route-local outer width, margin, or padding rules. Settings intentionally retains its centered 760px
  form layout. See `docs/frontend-ui.md` for the shell contract.
