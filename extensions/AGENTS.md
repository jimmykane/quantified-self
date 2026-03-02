# Extensions Agent Instructions

Read `/Users/dimitrios/Projects/quantified-self/AGENTS.md` first. Root rules remain mandatory here.

Shared instruction files stay in `../.agent/` for reuse by other apps/agents.

Inherited always-on rules:
- `../.agent/rules/verify-changes-with-tests.md` when extension changes have automated coverage

Role rules:
- `../.agent/rules/security-reviewer.md`

Verification note:
- Most extension env/config changes are documentation or deployment configuration only. If no automated tests cover the change, state that explicitly and validate the affected Firebase config manually.
