---
trigger: model_decision
description: Use for Angular + Vitest testing best practices and troubleshooting.
---

# Testing Guidelines

Use this rule when writing or debugging Angular tests with Vitest.

## Apply This Rule
- Creating or modifying `*.spec.ts`
- Fixing flaky or failing frontend tests

## Do Not Apply This Rule
- Backend-only test work in `functions/` (prefer backend test rules)

## General Principles
- Test behavior, not internals.
- Keep tests isolated and readable.
- Prefer robust assertions over snapshot-heavy tests.

## Angular + Vitest Practices
- Configure tests with `TestBed`.
- Use `vi.fn()` / `vi.mock()` for dependencies.
- Use `fakeAsync` + `tick` or async/await deliberately, not mixed arbitrarily.
- Trigger `fixture.detectChanges()` at controlled points.
- Use `NO_ERRORS_SCHEMA` sparingly.

## Naming
- Files: `*.spec.ts`
- Suites: `describe('ComponentName', ...)`
- Specs: `it('should ...', ...)`
