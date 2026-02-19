---
trigger: always_on
description: Require test verification for every round of code changes.
---

# Test Verification Enforcement

Run tests **immediately after each round of edits** — do not wait until the end of the task.

## Requirements
1. After editing any file, identify spec files that cover it.
2. Run those specs before moving to the next task step.
3. Report pass/fail clearly and fix failures before continuing.
4. If no tests exist, add a basic test when practical or state why testing was skipped.

## Commands
```bash
npx vitest run <spec-file> [<spec-file2>...] --reporter=verbose
```

## Context7 Usage
- Use `context7` docs for runner-specific flags (`ng test`, `vitest`) when needed.
