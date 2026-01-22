---
name: security-review
description: Review Firebase Security Rules and Angular application security patterns
---

# Security Review Skill

Perform security audits focusing on Firebase Security Rules and Angular application security.

## Quick Commands

```bash
# Validate Firestore rules syntax
firebase deploy --only firestore:rules --dry-run

# Run Firestore rules tests
npm run test:rules
```

## Firebase Security Rules Review

### Location
- Rules file: `firestore.rules`
- Rules tests: `src/firestore.rules.spec.ts`

### Common Vulnerabilities

| Issue | Risk | Check |
|-------|------|-------|
| Missing auth check | HIGH | Every rule should check `request.auth != null` |
| Overly permissive writes | HIGH | Validate data shape on writes |
| Missing resource ownership | HIGH | Verify `request.auth.uid == resource.data.userId` |
| Read-only fields modified | MEDIUM | Use `!('fieldName' in request.resource.data.diff(resource.data))` |
| Unbounded list queries | MEDIUM | Add limits to collection reads |

### Security Rules Checklist

```
[ ] All collections require authentication
[ ] Users can only access their own data (uid check)
[ ] Admin operations check custom claims
[ ] Write operations validate data structure
[ ] Sensitive fields cannot be modified after creation
[ ] Delete operations are appropriately restricted
```

### Testing Rules Changes

```bash
# Start emulator and run rules tests
npm run test:rules

# Or manually:
npx firebase emulators:exec --project demo-test --only firestore 'npx vitest run --config vitest.rules.config.ts'
```

## Angular Application Security

### Authentication Checks

| Pattern | Location |
|---------|----------|
| Route guards | `src/app/authentication/` |
| Pro-only directive | `src/app/directives/pro-only.directive.ts` |
| Has-role directive | `src/app/directives/has-role.directive.ts` |

### Secure Coding Checklist

```
[ ] No hardcoded API keys in source code
[ ] Environment files excluded from git
[ ] Firebase App Check enabled
[ ] CORS configured correctly on Cloud Functions
[ ] User input sanitized before storage
[ ] Error messages don't leak sensitive info
```

## Review Template

When performing a security review, document findings using this format:

```markdown
## Security Review: [Feature/Component]

### Scope
- Files reviewed: [list]
- Rules affected: [list]

### Findings

#### [CRITICAL/HIGH/MEDIUM/LOW] - Issue Title
- **Location**: `file:line`
- **Issue**: Description
- **Risk**: Potential impact
- **Recommendation**: How to fix
```
