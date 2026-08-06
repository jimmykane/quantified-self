# Frontend Agent Instructions

Read `/Users/dimitrios/Projects/quantified-self/AGENTS.md` first.

Frontend-only rules:
- `../.agent/rules/rules.md`
- `../.agent/rules/material-design-strict.md`
- Authenticated product workspace routes must apply the shared `qs-workspace-page` class to their route root. Do not add
  route-local outer width, margin, or padding rules; keep intentional readable-width constraints on inner content only.
  See `docs/frontend-ui.md` for the shell contract.
