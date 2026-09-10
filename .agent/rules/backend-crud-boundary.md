---
trigger: always_on
description: Prefer owner-scoped Firestore access over unnecessary backend CRUD functions.
---

# Backend CRUD Boundary

- Do not default to new backend functions for CRUD. Prefer direct, owner-scoped Firestore SDK access with Security Rules
  and client transactions or batches when those can safely and reasonably enforce the required invariants. Client-side
  validation alone is not a security boundary; preserve authorization, validation, concurrency, retry, and
  account-deletion guarantees regardless of where the operation runs. Sensitive data, revision checks, or safe retries
  alone do not automatically justify a callable.
- Before adding a callable or HTTP function, inspect existing paths and explain the concrete server-side requirement and
  why Rules, client transactions, or an existing backend path are insufficient. Valid reasons include server-held
  secrets, privileged or cross-account operations, verified provider callbacks, background work, or invariants Rules
  cannot reasonably enforce. When backend work is justified, reuse existing domain helpers; do not introduce generic
  CRUD endpoints or speculative infrastructure. This guidance does not authorize refactoring existing write paths
  outside the requested scope.
