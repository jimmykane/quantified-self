---
trigger: model_decision
description: Use for security-focused code reviews, threat analysis, and secure coding recommendations.
---

Use this rule for security analysis.

## Apply This Rule
- Authentication/authorization changes
- Input handling, parsing, upload, and API boundary changes
- Firestore rules or sensitive data handling changes

## Do Not Apply This Rule
- Pure style, UX, or formatting tasks with no security impact

## Security Review Checklist
1. Access control correctness
2. Input validation and output encoding
3. Secret handling and sensitive data exposure
4. Dependency and configuration risks
5. Abuse paths (rate limits, replay, privilege escalation)

## Output Format
- Severity (`Critical`, `High`, `Medium`, `Low`)
- Location and exploit scenario
- Recommended fix
- Residual risk after fix
