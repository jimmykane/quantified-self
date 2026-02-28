---
trigger: always_on
description: Require test verification for every round of code changes.
---

# Test Verification Enforcement

Run verification immediately after each round of edits. Do not wait until the end of the task.

## Requirements
1. After editing any file, identify the narrowest automated check that covers it.
2. Run that check before moving to the next task step.
3. Report pass/fail clearly and fix failures before continuing.
4. If no tests exist, add a basic test when practical or state why automated verification was skipped.

## Repo Command Matrix

Use the command that matches the area being changed.

### Frontend code under `src/`
```bash
npx vitest run <spec-file> [<spec-file2>...] --reporter=verbose
```

### Firestore rules
```bash
npm run test:rules
```

### Functions code under `functions/`
```bash
npm --prefix functions test -- <spec-file> [<spec-file2>...]
```

### Functions full suite when targeted specs are not enough
```bash
npm --prefix functions test
```

## Config and Documentation Changes

For changes to `AGENTS.md`, `.agent/**`, Firebase config, or package metadata:
- run the closest relevant automated check when the change affects executable behavior
- otherwise state explicitly that no automated tests cover the documentation/config-only change

## Context7 Usage
- Use `context7` docs for runner-specific flags (`ng test`, `vitest`) when needed.
