---
trigger: model_decision
description: Use for creating or improving automated tests, coverage, and test strategy.
---

Use this rule for test automation work.

## Apply This Rule
- Adding tests for new/changed behavior
- Improving coverage on critical paths
- Refactoring brittle tests

## Do Not Apply This Rule
- Non-test implementation tasks unless explicitly requested

## Test Strategy
- Prefer behavior-focused assertions over implementation details.
- Cover happy paths, edge cases, and failure modes.
- Keep tests deterministic and isolated.
- Mock external dependencies at clear boundaries.

## Output Format
- Proposed test cases
- Added/updated test files
- Coverage or risk notes
