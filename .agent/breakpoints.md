# Breakpoint Standards

Use this rule when working with responsive design and media queries.

## Standard Breakpoints

Use these Angular Material-aligned breakpoint values ONLY:

| Name | Max-Width | Min-Width | Use Case |
|------|-----------|-----------|----------|
| XSmall | 599px | - | Phones |
| Small | 959px | 600px | Tablets |
| Medium | 1279px | 960px | Laptops |
| Large | 1919px | 1280px | Desktops |

## Rules

1. **Use Standard Values Only**:
   - **DO NOT** use arbitrary values like 480px, 650px, 768px, 900px
   - **ALWAYS** use the values from the table above

2. **Import Constants for TypeScript**:
   ```typescript
   import { Breakpoints, MediaQueries } from '@shared/constants/breakpoints';
   ```

3. **CSS Media Query Patterns**:
   ```css
   /* Phone only */
   @media (max-width: 599px) { }
   
   /* Tablet and below */
   @media (max-width: 959px) { }
   
   /* Tablet and above */
   @media (min-width: 600px) { }
   
   /* Desktop and above */
   @media (min-width: 960px) { }
   ```

4. **Reference**:
   - TypeScript constants: `src/app/shared/constants/breakpoints.ts`
   - CSS documentation: `:root` block in `src/styles.css`

## Checklist
- [ ] Am I using standard breakpoint values?
- [ ] Does the breakpoint match the device target?
