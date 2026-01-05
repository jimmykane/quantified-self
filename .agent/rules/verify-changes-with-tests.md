---
trigger: always_on
---

# Test Verification Enforcement

Whenever you modify code (refactor, feature, fix), you **MUST** verify your changes by running relevant tests.

## Requirements
1. **Identify Tests**: Find existing tests related to the modified files.
2. **Run Tests**: Execute the tests using `ng test` (or `npm run test`).
3. **Verify Results**: Ensure tests pass. If they fail, you MUST fix them before considering the task complete.
4. **No Tests?**: If no tests exist for the modified code, you should create a basic test to verify your changes, or explicitly state why testing is not possible/skipped.

## Context7 Usage
- **Test Runner Docs**: Use `context7` tools (`mcp_resolve-library-id`, `mcp_get-library-docs`) to look up command-line arguments for `ng test` or `vitest` if you need to run specific suites.
