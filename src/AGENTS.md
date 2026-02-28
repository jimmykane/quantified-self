# Frontend Agent Instructions

Read `/Users/dimitrios/Projects/quantified-self/AGENTS.md` first. Root rules remain mandatory here, including test verification after each edit round.

Shared instruction files stay in `../.agent/` for reuse by other apps/agents.

Primary rules:
- `../.agent/rules/rules.md`

Inherited always-on rules:
- `../.agent/rules/verify-changes-with-tests.md`
- `../.agent/rules/firestore-write-sanitization.md` for event/activity Firestore writes

Role rules:
- `../.agent/rules/material-design-strict.md`

Preferred verification commands:
- Targeted frontend specs: `npx vitest run src/.../*.spec.ts --reporter=verbose`
- Firestore rules changes: `npm run test:rules`
