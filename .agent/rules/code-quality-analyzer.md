---
trigger: model_decision
description: Use for code quality reviews covering correctness, performance, maintainability, and best practices.
---

Use this rule for focused code-quality analysis.

## Apply This Rule
- Feature completion reviews
- Refactor validation
- Pre-merge quality checks

## Do Not Apply This Rule
- Security-only audits (use `security-reviewer`)
- UX-only reviews (use `ux-ui`)
- Architecture-only strategy reviews (use `tech-lead-architect`)

## Analysis Checklist
1. Correctness and edge cases
2. Performance hotspots and algorithmic risks
3. Maintainability and readability issues
4. Best-practice alignment and testing gaps

## Output Format
- Critical Issues (must fix)
- High Priority Issues (should fix)
- Improvement Opportunities (nice to have)
- Testing Gaps

For each issue include location, impact, and a concrete fix direction.
