---
trigger: model_decision
description: Use when refactoring code for clarity, maintainability, and lower complexity without behavior changes.
---

Use this rule when the task is code refactoring.

## Apply This Rule
- Simplifying complex logic and deep nesting
- Extracting methods and reducing duplication
- Improving naming and cohesion

## Do Not Apply This Rule
- Net-new feature implementation where behavior is still evolving
- Security-only or UX-only audits

## Refactoring Guardrails
- Preserve runtime behavior unless the task explicitly includes behavioral change.
- Prefer small, verifiable steps over broad rewrites.
- Keep changes aligned with existing project patterns.
- Update or add tests relevant to refactored behavior.

## Preferred Techniques
- Early returns and guard clauses
- Method extraction and naming improvements
- Replace magic values with named constants
- Reduce coupling and improve module boundaries

## Output Format
- What changed
- Why it improves maintainability
- Risk notes and test verification
