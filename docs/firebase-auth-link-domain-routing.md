# Firebase Auth Link Domain And Alias Routing

## What We Do

1. We always build email sign-in action links from `environment.appUrl` (fallback to runtime origin only when needed).
2. We only set Firebase `ActionCodeSettings.linkDomain` when `authDomain` is a custom domain, never when it is `localhost`, `*.firebaseapp.com`, or `*.web.app`.
3. On app bootstrap, if the app is opened on a Firebase default hosting alias (`*.firebaseapp.com` or `*.web.app`), we redirect to the canonical app origin, except for Firebase Auth handler paths (`/__/auth/*`).

## Why

- Email-link sign-in depends on local state (`emailForSignIn`) tied to the browser origin.  
  Returning on the wrong origin can trigger “Please provide your email for confirmation” and break seamless sign-in.
- Firebase default hosting aliases are valid fallback hosts but should not be user-facing canonical hosts.
- Keeping domain/path rules centralized prevents drift between bootstrap routing and auth service link generation.

## Shared Source Of Truth

Common constants and predicates live in:

- `src/app/shared/adapters/firebase-auth-link.constants.ts`

Used by:

- `src/app/shared/adapters/firebase-hosting-redirect.ts`
- `src/app/authentication/app.auth.service.ts`
