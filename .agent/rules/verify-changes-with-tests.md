---
trigger: always_on
description: Require test verification for code changes before task completion.
---

# Test Verification Enforcement

Whenever code is modified (feature, fix, refactor), run relevant tests.

## Requirements
1. Identify tests related to changed files.
2. Execute the relevant test command(s).
3. Report pass/fail clearly.
4. If no tests exist, add a basic test when practical or state why testing was skipped.

## Context7 Usage
- Use `context7` docs for runner-specific flags (`ng test`, `vitest`) when needed.
