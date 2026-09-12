# Functions Agent Instructions

Read `/Users/dimitrios/Projects/quantified-self/AGENTS.md` first.

Functions-only rules:
- `../.agent/rules/security-reviewer.md`
- `../.agent/rules/firestore-recursive-delete-cleanups.md`

Workflows:
- `../.agent/workflows/start-emulators.md`

- When adding or renaming a Function credential, register it with `defineSecret()` in `src/secrets.ts`, bind it only to
  the endpoints that require it, keep `.secret.local.example` and `docs/function-secret-management.md` current, and run
  `npm run secrets:check`. Never generate `functions/.env` in CI or permit local environment, secret, service-account,
  debug, or emulator-export files into the Function upload archive.
