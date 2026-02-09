---
trigger: model_decision
description: Use this agent when you need to evaluate frontend code, user interfaces, or web applications for user experience quality
---

Use this rule to review frontend UX quality, accessibility, and interaction behavior.

## Apply This Rule
- UI component changes
- Form and interaction flow changes
- Accessibility and responsive behavior audits

## Review Checklist

1. **Accessibility Audit**:
   - Verify semantic HTML usage and proper heading hierarchy
   - Check ARIA labels, roles, and states implementation
   - Ensure keyboard navigation and focus management
   - Validate color contrast ratios and text sizing
   - Identify missing alt text or inadequate descriptions
   - Test for screen reader announcement clarity

2. **Usability Analysis**:
   - Evaluate interaction patterns for intuitiveness
   - Assess error handling and user feedback mechanisms
   - Review form validation and helper text clarity
   - Check loading states and pass/fail criteria (use `<app-loading-overlay>` for content blocks)
   - Verify touch target sizes (minimum 44x44px)
   - Analyze information hierarchy and visual flow

3. **Design Consistency**:
   - Verify adherence to established design systems
   - Check component reusability and consistency
   - Evaluate visual hierarchy and spacing
   - Review typography scales and readability
   - Assess color usage and theme implementation

4. **Performance Considerations**:
   - Identify render-blocking resources
   - Check for unnecessary re-renders or layout shifts
   - Evaluate animation performance and smoothness
   - Review lazy loading implementation
   - Assess bundle size impact

5. **Responsive Behavior**:
   - Follow the project breakpoint rule in `.agent/rules/breakpoints.md`
   - Test breakpoint implementations against that standard
   - Verify mobile-first approach
   - Check viewport meta tags and scaling
   - Evaluate touch gesture support
   - Review orientation change handling

## Review Output
- **Critical Issues**: Accessibility violations, unusable interfaces, broken interactions
- **High Priority**: Usability problems, inconsistent patterns, performance bottlenecks
- **Recommendations**: Enhancement suggestions, best practice improvements
- **Positive Findings**: Well-implemented patterns worth highlighting

For each issue, provide:
- Specific location in code
- Clear explanation of the problem
- User impact assessment
- Concrete fix with code example
- Testing methodology to verify the fix

## Context7 Usage

- **Accessibility Guidelines**: Use `context7` to verify WCAG 2.1/2.2 guidelines if you are unsure about a specific accessibility requirement.
- **Design Systems**: Use `context7` to look up Material Design 3 guidelines or other design system references.
- **Best Practices**: Use `context7` to research UX best practices for specific patterns (e.g., "mobile navigation patterns", "form validation UX").
