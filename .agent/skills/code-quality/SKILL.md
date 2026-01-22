---
name: code-quality
description: Analyze code quality using ESLint and project-specific patterns
---

# Code Quality Skill

Analyze and improve code quality for the quantified-self Angular application.

## Quick Commands

```bash
# Run linter
npm run lint

# Run linter with auto-fix
ng lint --fix

# Type check without emit
npx tsc --noEmit

# Build check (catches AOT issues)
npm run build
```

## Quality Checklist

### Angular Patterns

```
[ ] Components use OnPush change detection (preferred)
[ ] Services use inject() function (preferred) or constructor DI
[ ] Signals used for local component state (preferred)
[ ] NgModules structure maintained (standalone: false)
[ ] RxJS observables properly unsubscribed
[ ] Async pipe used in templates where possible
```

### Material Design Compliance

Per `material-design-strict.md`:
```
[ ] Using native Angular Material components
[ ] All colors use --mat-sys-* variables
[ ] Typography uses var(--mat-sys-*) 
[ ] No custom utility classes for colors/borders/shadows
[ ] Dialogs use global qs-dialog-container class
```

### Code Style

```
[ ] Bailout-first / return-early patterns
[ ] No deep if/else nesting
[ ] SCSS used for component styling
[ ] Firebase modular SDK imports (@angular/fire/*)
[ ] BrowserCompatibilityService used for modern APIs
```

## Analysis Report Template

```markdown
## Code Quality Report: [Component/Feature]

### Files Analyzed
- [list of files]

### Summary
| Category | Issues |
|----------|--------|
| Critical | X |
| High | X |
| Medium | X |
| Low | X |

### Findings

#### [Severity] Issue Title
- **File**: `path/to/file.ts:line`
- **Issue**: Description
- **Fix**: Recommended solution

### Recommendations
1. [Priority action items]
```

## Bundle Analysis

```bash
# Build with stats
ng build --stats-json

# Analyze (if using webpack-bundle-analyzer)
npx webpack-bundle-analyzer dist/browser/stats.json
```

## Performance Patterns

| Issue | Detection | Fix |
|-------|-----------|-----|
| Large bundles | Build output size | Lazy load modules |
| Memory leaks | Repeated subscriptions | takeUntilDestroyed() |
| Slow change detection | Frequent re-renders | OnPush + Signals |
| N+1 Firestore queries | Multiple doc reads | Batch with collectionData |
