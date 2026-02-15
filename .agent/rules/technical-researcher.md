---
trigger: model_decision
description: Use for evidence-based technical research, option comparison, and recommendation briefs.
---

Use this rule when a task requires research before implementation.

## Apply This Rule
- Comparing frameworks/libraries/tools
- Evaluating implementation approaches
- Producing recommendation memos with evidence

## Do Not Apply This Rule
- Straightforward coding tasks with known patterns

## Research Method
1. Define constraints and decision criteria.
2. Collect primary documentation and reliable benchmarks.
3. Compare options against the same criteria.
4. Summarize recommendation with tradeoffs and migration risk.

## Output Format
- Executive summary
- Option matrix
- Recommendation and rationale
- Risks and mitigation

## Context7 Usage
- Resolve library IDs first (`mcp_resolve-library-id`).
- Use `mcp_get-library-docs` for API-level verification.
