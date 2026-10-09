# Functions Agent Instructions

Read `/Users/dimitrios/Projects/quantified-self/AGENTS.md` first.

Functions-only rules:
- `../.agent/rules/security-reviewer.md`
- `../.agent/rules/firestore-recursive-delete-cleanups.md`

Workflows:
- `../.agent/workflows/start-emulators.md`

- Always persist the real Firebase UID on account mail when it is created, and preserve it through retries and
  updates. Prefer an inert top-level `uid`; existing `toUids` and `marketing.uid` ownership are supported too.
  This includes registration, subscription, confirmation, marketing, CSV and manual/test senders. An email address
  or UID embedded only in the document ID is not a substitute for an ownership field. Never add `toUids` just as
  metadata if it changes delivery recipients; use `uid` instead.
- Account mail must also include `expireAt` using `TTL_CONFIG.MAIL_IN_DAYS`. Apply the shared deletion guard inside
  account-mail write transactions; deletion confirmations deliberately follow Auth deletion. Tests for changed
  mail writers must assert UID ownership and expiry. Auth lookup failures must not silently produce unattributed mail.
- Mail account cleanup is UID-only: do not reintroduce email-address matching. Historical email-only records are
  outside its completion scope, even when they lack TTL. An explicitly selected external test inbox with no app
  account may omit UID, but must retain expiry; never invent a UID for a non-account recipient.
- Mail-related tracking/deduplication records that retain recipient data must also carry UID ownership and expiry,
  and participate in explicit UID-based account cleanup. A mail document's TTL does not remove a separate tracking
  record; never assume an `expireAt` field activates TTL for another collection.
- When adding or renaming a Function credential, register it with `defineSecret()` in `src/secrets.ts`, bind it only to
  the endpoints that require it, keep `.secret.local.example` and `docs/function-secret-management.md` current, and run
  `npm run secrets:check`. Never generate `functions/.env` in CI or permit local environment, secret, service-account,
  debug, or emulator-export files into the Function upload archive.
- For every new deployed Function, add its export to `src/full-entrypoint.ts` and a direct owner-module loader to
  `src/function-target-loader.ts` before deployment. Extend the loader spec and `src/scripts/check-entrypoint-loading.ts`
  to prove single-target loading and preserve its trigger, region, memory, retry, timeout, concurrency, and secret options
  where applicable; run the entrypoint check and cold-import benchmark. If isolation is unsafe, document the specific
  exception and memory plan in the same change instead of silently leaving the new target on the full entrypoint.
