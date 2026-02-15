---
trigger: model_decision
description: Use for UX, accessibility, and interaction-quality reviews of frontend changes.
---

Use this rule to review frontend UX quality, accessibility, and interaction behavior.

## Apply This Rule
- UI component changes
- Form and interaction flow changes
- Accessibility and responsive behavior audits

## Do Not Apply This Rule
- Backend-only logic and infrastructure changes

## Review Checklist
1. Accessibility: semantics, ARIA, keyboard flow, focus management, contrast.
2. Usability: clarity of interactions, validation messaging, loading/empty/error states.
3. Consistency: spacing, hierarchy, typography, design-system alignment.
4. Performance perception: avoid jank/layout shift in common interactions.
5. Responsive behavior: follow `.agent/rules/breakpoints.md`.

## Review Output
- Critical Issues
- High Priority Issues
- Recommendations
- Positive Findings

For each issue include location, impact, and concrete fix guidance.

## Context7 Usage
- Use `context7` for WCAG and Material Design references when uncertain.
