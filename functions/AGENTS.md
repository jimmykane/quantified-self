# Functions Agent Instructions

Read `/Users/dimitrios/Projects/quantified-self/AGENTS.md` first. Root rules remain mandatory here, including test verification after each edit round.

Shared instruction files stay in `../.agent/` for reuse by other apps/agents.

Inherited always-on rules:
- `../.agent/rules/verify-changes-with-tests.md`
- `../.agent/rules/firestore-write-sanitization.md` for event/activity Firestore writes

Role rules:
- `../.agent/rules/security-reviewer.md`

Workflows:
- `../.agent/workflows/start-emulators.md`

Preferred verification commands:
- Targeted backend specs: `npm --prefix functions test -- src/.../*.spec.ts`
- Full backend suite when needed: `npm --prefix functions test`
