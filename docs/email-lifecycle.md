# Email lifecycle

This document is the source of truth for Quantified Self transactional email ownership, copy, template rollout, and verification. Marketing campaigns are outside this lifecycle. The existing `development_update` template is intentionally excluded from this refresh and from the seeding allowlist.

## Lifecycle and ownership

| Event | Delivery owner | Template ID | From | Reply-To |
| --- | --- | --- | --- | --- |
| Onboarding first becomes complete | Cloud Function + Trigger Email extension | `registration_welcome` | `Dimitrios from Quantified Self <hello@quantified-self.io>` | `dimitrios@quantified-self.io` |
| Subscription starts or trial starts | `onSubscriptionUpdated` + Trigger Email extension | `welcome_email` | `Quantified Self <hello@quantified-self.io>` | `support@quantified-self.io` |
| Subscription upgrade | `onSubscriptionUpdated` + Trigger Email extension | `subscription_upgrade` | Standard transactional sender | Standard transactional reply address |
| Subscription downgrade | `onSubscriptionUpdated` + Trigger Email extension | `subscription_downgrade` | Standard transactional sender | Standard transactional reply address |
| Cancellation scheduled | `onSubscriptionUpdated` + Trigger Email extension | `subscription_cancellation` | Standard transactional sender | Standard transactional reply address |
| Subscription expiring soon | `checkSubscriptionNotifications` + Trigger Email extension | `subscription_expiring_soon` | Standard transactional sender | Standard transactional reply address |
| Account deletion accepted | `deleteSelf` + Trigger Email extension | `account_deleted_confirmation` | Standard transactional sender | Standard transactional reply address |
| Passwordless sign-in | Firebase Authentication | Firebase email-link template | `Quantified Self <noreply@quantified-self.io>` | `support@quantified-self.io` |
| Password reset | Firebase Authentication | Firebase password-reset template | Firebase Auth sender above | `support@quantified-self.io` |

The founder welcome is sent once, only when `users/{uid}.onboardingCompleted` first changes to `true`. It combines a formal welcome to the Quantified Self platform with Dimitrios's personal introduction and invitation to reply with support needs, feature requests, or product feedback. Its recipient and greeting come from Firebase Auth, not profile email data supplied by the client. The TTL-managed mail document is `registration_welcome_{uid}`; durable deduplication is stored in the server-owned `users/{uid}/system/emailLifecycle` document and is created atomically with the mail item. There is no existing-user backfill, generic registration email, delayed follow-up, or marketing-consent dependency.

## Firestore template source of truth

The allowlisted template and partial catalog is in `functions/src/email/template-catalog.ts`. HTML and plaintext sources are under `functions/templates/`. Standard sender addresses, URLs, date formatting, grace-period calculation, and plan descriptions are centralized in `functions/src/email/config.ts`; numeric limits and device-sync entitlement come from `shared/limits.ts`.

The templates use escaped Handlebars expressions, responsive table layouts, plaintext alternatives, and environment-specific partials supported by the [Firebase Trigger Email extension](https://firebase.google.com/docs/extensions/official/firestore-send-email/templates). Unknown plan roles intentionally render without a benefits list.

Cancellation emails and the subscription trigger share one grace deadline. `onSubscriptionUpdated` transactionally re-reads the current active subscriptions plus the user-deletion guard before changing grace state. When every active subscription is scheduled to end, it stores the latest `current_period_end + 30 days` as `scheduledGracePeriodUntil`; any continuing subscription clears that scheduled deadline. Subscription mail creation performs the same current-state and deletion-guard reads in its own transaction, preserves existing deterministic mail documents, and queues cancellation copy only for the canonical latest end when every active entitlement is ending. The expiring-reminder job uses the same aggregate rule, so it skips earlier-ending subscriptions and any user with a continuing entitlement. When paid access ends, `onSubscriptionUpdated` promotes the exact timestamp to `gracePeriodUntil`. The existing enforcement job remains a conservative fallback if subscription-event processing exhausts its retry window; changing its account-level entitlement selection is tracked separately from this email refresh.

Local verification:

```bash
npm --prefix functions test -- src/email/template-catalog.spec.ts
npm --prefix functions run render-emails -- /tmp/quantified-self-email-previews
npm --prefix functions run build
```

The template spec compiles every approved subject, HTML body, plaintext body, and partial with Free, Basic, Pro, trial, conditional-device-sync, and unknown-role examples. It validates rendered URLs, rejects unresolved variables, and pins the SHA-256 of `development_update.hbs` so an accidental byte change fails the test.

## Firebase Authentication templates

Keep magic-link and password-reset delivery in Firebase Authentication. This preserves Firebase's one-time action-code handling, expiry, abuse protections, and existing client SDK flow.

### Timestamp preservation rule

Firebase recommends retaining the timestamp in both the email-link subject and body so repeated sign-in messages do not collapse into one thread and hide the newest link. See [Firebase email-link guidance](https://firebase.google.com/docs/auth/web/email-link-auth#default_email_template_for_link_sign-in).

In the approved copy below, `⟦CURRENT FIREBASE TIMESTAMP TOKEN⟧` is an editorial marker, **not literal text to paste**. Before making any edit, copy the timestamp token or timestamp fragment from the currently active Firebase email-link subject and body. Replace both editorial markers with that exact Firebase value. Do not invent a placeholder: Firebase's publicly documented account-email placeholders do not identify a general timestamp placeholder.

If the console renders a timestamp but does not expose a reusable token, do not save the customized magic-link template until a Firebase preview or controlled send proves that a fresh timestamp remains in both the subject and body. Missing or static timestamps block rollout.

### Email-link sign-in

Subject:

```text
Sign in to Quantified Self — ⟦CURRENT FIREBASE TIMESTAMP TOKEN⟧
```

HTML body:

```html
<p>Use the link below to sign in to Quantified Self.</p>
<p><a href="%LINK%">Sign in to Quantified Self</a></p>
<p>This is a one-time sign-in link. Do not forward or share it.</p>
<p>If you did not request this email, you can safely ignore it.</p>
<p>Requested: ⟦CURRENT FIREBASE TIMESTAMP TOKEN⟧</p>
```

The `%LINK%` placeholder must remain exactly as shown.

### Password reset

Subject:

```text
Reset your Quantified Self password
```

HTML body:

```html
<p>We received a request to reset your Quantified Self password.</p>
<p><a href="%LINK%">Reset password</a></p>
<p>If you did not request a password reset, you can ignore this email and your password will remain unchanged.</p>
```

The `%LINK%` placeholder must remain exactly as shown.

### Firebase console procedure and release gate

1. Open Firebase Console → Security → Authentication → Templates.
2. Record the current email-link subject, body, timestamp token/fragment, action URL, sender, and Reply-To before editing.
3. Edit the email-link and password-reset copy using the approved text above. Preserve `%LINK%` and the existing email-link timestamp value exactly.
4. Set the public sender name to `Quantified Self`, sender address to `noreply@quantified-self.io`, and Reply-To to `support@quantified-self.io`.
5. Use **Customize domain** and complete the TXT/CNAME records Firebase provides. Follow [Firebase's custom Auth email domain procedure](https://firebase.google.com/docs/auth/email-custom-domain).
6. Wait until Firebase displays the green **Verification complete** state, then apply the custom domain.
7. Do not proceed with rollout unless a controlled email-link send shows a fresh timestamp in its subject and body, the newest link is visible, and the From/Reply-To headers are correct.

DNS and Firebase Console changes are manual production changes and must not be performed as part of a local implementation task.

## Manual rollout

All steps below require separate operational approval.

1. Confirm `dimitrios@quantified-self.io` receives external replies.
2. Apply and smoke-test the Firebase Authentication templates and verified sender domain as described above.
3. Seed only the refreshed Firestore templates and required partials. The default command selects the full refreshed allowlist and cannot select `development_update`:

   ```bash
   npm --prefix functions run seed-emails
   ```

   A narrower rollout can use a comma-separated allowlist:

   ```bash
   npm --prefix functions run seed-emails -- --templates=registration_welcome,welcome_email
   ```

4. Deploy only the functions whose email behavior changed:

   ```bash
   firebase deploy --only functions:sendRegistrationWelcomeEmail,functions:onSubscriptionUpdated,functions:checkSubscriptionNotifications,functions:deleteSelf
   ```

5. Queue all refreshed plan/trial variants to a controlled inbox:

   ```bash
   npm --prefix functions run test-emails -- controlled-inbox@example.com
   ```

6. Verify From, Reply-To, subject, plaintext alternative, links, 390px mobile layout, desktop layout, trial copy, Free/Basic/Pro limits, grace dates, and device-sync conditions.

Do not deploy functions before the required Firestore templates and partials exist. Do not seed templates before reviewing the generated local previews.

## Help-page review

The in-app Help content was reviewed for magic-link troubleshooting, membership management, marketing consent, and account deletion. No Help copy change is required: this refresh changes delivery and email wording, not the in-app workflow or user-visible product behavior.
