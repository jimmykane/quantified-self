---
trigger: always_on
description: Require verification after code changes and reuse existing test results for review-only requests.
---

# Test Verification Enforcement

Run the narrowest relevant verification immediately after each round of code or executable configuration edits.
Do not wait until the end of the task.

## Requirements
1. After editing code or executable configuration, identify the narrowest automated check that covers it.
2. Run that check before moving to the next task step.
3. Report pass/fail clearly and fix failures before continuing.
4. If no tests exist, add a basic test when practical or state why automated verification was skipped.
5. Prefer narrow helper or service specs for deterministic transformation logic instead of broader component or integration tests when they cover the behavior completely.

## Review-Only Requests

- Requests to review, audit, or re-review existing changes do not trigger test runs or reruns. This applies to every
  agent, including a separate reviewer, even when the diff contains earlier code changes.
- Reuse recorded test results that cover the current code. If results are missing, outdated, or insufficient, report
  the verification gap without running tests or claiming that unverified behavior passed.
- If the review leads to code or executable configuration edits, run the narrowest checks covering those new edits
  under the requirements above. Do not rerun unrelated suites solely to complete the review.
- An explicit user request to run tests authorizes test execution even when no files have changed.

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
