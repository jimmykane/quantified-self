# Email lifecycle

This document is the source of truth for Quantified Self transactional and admin marketing email ownership, copy, template rollout, and verification. Marketing campaigns are outside the automatic transactional lifecycle. The existing `development_update` template remains intentionally excluded from every seed path. Explicitly reviewed manual campaigns, such as `coros_delivery_update`, are excluded from the default seed and smoke-test flows and can be selected only by exact template ID.

## Lifecycle and ownership

| Event | Delivery owner | Template ID | From | Reply-To |
| --- | --- | --- | --- | --- |
| Onboarding first becomes complete | Cloud Function + Trigger Email extension | `registration_welcome` | `Dimitrios from Quantified Self <hello@quantified-self.io>` | `dimitrios@quantified-self.io` |
| Subscription starts or trial starts | `onSubscriptionUpdated` + Trigger Email extension | `welcome_email` | `Quantified Self <hello@quantified-self.io>` | `support@quantified-self.io` |
| Subscription upgrade | `onSubscriptionUpdated` + Trigger Email extension | `subscription_upgrade` | Standard transactional sender | Standard transactional reply address |
| Subscription downgrade | `onSubscriptionUpdated` + Trigger Email extension | `subscription_downgrade` | Standard transactional sender | Standard transactional reply address |
| Cancellation scheduled | `onSubscriptionUpdated` + Trigger Email extension | `subscription_cancellation` | Standard transactional sender | Standard transactional reply address |
| Subscription expiring soon | `checkSubscriptionNotifications` + Trigger Email extension | `subscription_expiring_soon` | Standard transactional sender | Standard transactional reply address |
| Admin grants complimentary subscription time | `grantAdminSubscriptionGift` + Trigger Email extension | `subscription_time_gift` | Standard transactional sender | Standard transactional reply address |
| Account deletion accepted | `deleteSelf` + Trigger Email extension | `account_deleted_confirmation` | Standard transactional sender | Standard transactional reply address |
| Admin marketing campaign | Admin workspace + scheduled worker + Trigger Email extension | Inline-rendered `marketing_campaign` | `Dimitrios from Quantified Self <updates@quantified-self.io>` | `Dimitrios <dimitrios@quantified-self.io>` |
| Passwordless sign-in | Firebase Authentication | Firebase email-link template | `Quantified Self <noreply@quantified-self.io>` | `support@quantified-self.io` |
| Password reset | Firebase Authentication | Firebase password-reset template | Firebase Auth sender above | `support@quantified-self.io` |

The founder welcome is sent once, only when `users/{uid}.onboardingCompleted` first changes to `true`. It combines a formal welcome to the Quantified Self platform with Dimitrios's personal introduction and asks which one question the recipient would ask their training history. The hypothetical wording does not claim that connected data is complete, and the invitation to reply also covers support needs, feature requests, and other product feedback. The copy deliberately avoids assuming why someone joined or how they intend to use the platform. Its recipient and greeting come from Firebase Auth, not profile email data supplied by the client. The TTL-managed mail document is `registration_welcome_{uid}`; durable deduplication is stored in the server-owned `users/{uid}/system/emailLifecycle` document and is created atomically with the mail item. There is no existing-user backfill, generic registration email, delayed follow-up, or marketing-consent dependency.

The subscription-time gift email is optional and defaults on in the admin dialog. It names the existing plan, gifted calendar-month count, and new access date, but never receives or renders the internal admin reason. Mail is queued only after Stripe is confirmed successful. Its deterministic document ID includes a digest of the user and operation plus a bounded attempt number; a retry reuses the same operation, deduplicates a pending or delivered message, and creates a new attempt only after the Trigger Email extension records an error. While requested delivery is queued or remains retryable, the preview API restores the successful operation and the dialog exposes a notification-only check or retry action; that path cannot apply the Stripe gift again. Email failure is recorded on the audit operation and never rolls back access. The mail item carries `toUids` so normal account deletion can remove it even if the Auth email lookup later becomes unavailable.

## Admin marketing campaigns

Admins use `/admin/marketing` to create a structured email in a constrained rich editor (paragraphs, emphasis, lists, links and one optional button). A debounced live preview uses the server renderer and shows the complete HTML, including the fixed footer, at desktop and phone widths or plaintext beside the editor; the preview uses a sample greeting and never submits mail. The preview frame grows with the email, and HTTPS and mailto links open separately instead of replacing the preview. Admins can choose Free, Basic or Pro plus an inclusive UTC Auth signup-date range. Server validation accepts only the supported document nodes and HTTPS or `mailto:` links; button links require HTTPS. The server renders the local `marketing_campaign` template using the founder welcome's header layout and a separate marketing footer. The onboarding welcome and its footer stay unchanged. The local template files are copied into the Functions deployment bundle by `npm --prefix functions run build`; the campaign does not depend on seeding a Firestore template. The Trigger Email extension receives a trusted inline `message` with HTML and text. Its top-level `headers` include `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.

`marketingCampaigns/{id}` is server-owned. An unsaved composer, saved draft, ready campaign, or paused campaign can be test-sent to one admin-selected email address. An unsaved test validates and renders the supplied message, reserves a daily slot and creates only the mail document; it does not create a campaign or satisfy a later campaign's launch requirement. The server validates the address, marks the subject `[TEST]`, and uses a test-only unsubscribe link whose GET and POST never change consent. The admin-only send still consumes a global UTC daily slot. Saving an edited draft or paused campaign clears its previous test result; Start and Resume require the latest saved-campaign test to be SMTP accepted.

**Prepare audience** queries the canonical `users/{uid}/legal/agreements.acceptedMarketingPolicy === true` document, excludes missing/disabled/admin Auth accounts, missing email/profile, deletion tombstones, and mismatched plan/signup dates, then writes a fixed `recipients/{uid}` snapshot with exact eligible and exclusion counts. Auth provider and `emailVerified` are deliberately not filters. New opt-ins do not enter a prepared campaign. Prepared filters and the recipient snapshot remain fixed; Clone creates a new draft with an editable audience.

Users manage marketing consent and usage analytics in **Settings → Privacy** (`/settings?section=privacy`), then select **Save changes**. Both controls use the existing owner-scoped legal-agreements write path and persist only explicitly changed booleans. Turning marketing consent off does not stop transactional account or billing messages. Newly rendered campaign emails link **Email preferences** directly to this section; already queued mail retains its original link.

Campaign HTML reuses the founder header and body shell, with a separate marketing footer. At phone widths (620 px and below), campaign body and footer use aligned 16 px side gutters and the outer gutter is removed; desktop spacing and onboarding welcome spacing are preserved. Already queued mail retains its rendered layout.

**Delete draft** and **Delete campaign** are available beside draft and prepared campaign rows and in the selected campaign's header. Prepared (`ready`) campaigns can be deleted before Start, removing their fixed recipient snapshot too. It requires confirmation and uses the existing admin-only `changeMarketingCampaignStatus` callable with `action: "delete"`. Deleting a different campaign preserves the current composer and unsaved edits. A failed deletion refreshes server state before showing the original error, exposing `Retry deletion` and locking edits if cleanup already began. Responses after navigating away do not update the detached composer or emit feedback. The shared UI/server eligibility check permits `draft`, a retry of `deleting`, or `ready` with no `startedAt` and zero queued, accepted, failed and skipped recipients. Pending/eligible recipients and saved test results do not block deletion. The server transaction atomically marks the campaign `deleting` and serializes with Start; a started campaign stays protected even if its scheduled sending time has not arrived. Saves, preparation, cloning, Start and saved tests reject that state. It recursively deletes every descendant collection before recursively deleting the campaign root, keeping the marker visible for retry if subtree cleanup fails. The list includes all `deleting` campaigns alongside other active campaigns. Repeating a completed deletion safely cleans any remaining orphaned descendants. Already submitted test mail, its delivery lifecycle and reserved daily slots remain intact; delivery callbacks do not recreate the removed campaign. Preparing, running, paused and completed campaigns cannot be deleted through this action. No new Function, Firestore permission or index is needed; rollout requires deploying `changeMarketingCampaignStatus` and the frontend with separate approval.

Admins can pause a running campaign, edit its internal name, subject, body, links, button or sending schedule, save changes, send a new test, and resume after SMTP acceptance. Saving while paused preserves the recipient snapshot, progress counts, exclusions and original start time. It never rewrites mail already queued, which may still be sent by the extension while the campaign is paused. Remaining pending recipients and explicit retries use the newly saved message. Pausing and resuming without saving edits retains the existing successful test.

### Daily sending time

**Send now** is the default, including for existing campaigns without a schedule. Start and Resume can immediately submit mail under the global cap. **Send daily at…** stores a validated `schedule: { time: "HH:mm", timeZone: "Europe/Helsinki" }` on the campaign. Choose the schedule before preparing the audience, or pause to change it. Start arms `nextScheduledSendAt` for the next occurrence in the selected IANA timezone. The existing five-minute worker begins the batch on its first run at or after that time; it is not a guarantee of exact SMTP or inbox delivery time. Tests bypass the schedule and still consume a daily slot.

The first mail reservation of a daily batch atomically advances `nextScheduledSendAt` and stores `scheduledDispatchUtcDate`. The batch can continue across worker invocations and cap increases within that UTC day, up to the shared limit. A UTC quota reset does not release another batch before the next selected daily time. The worker catches up a missed occurrence during its UTC day, with five minutes of grace for a tick just after UTC midnight; expired occurrences are skipped. With multiple campaigns, the oldest campaign eligible to send runs first; a future scheduled campaign does not block immediate campaigns. Daily caps remain UTC-based regardless of the campaign timezone.

Resume continues a batch already opened on the current UTC day. Otherwise it waits for the next occurrence, skipping times missed while paused. Saving a changed schedule clears the scheduling cursor and current batch marker, and requires a fresh saved-message test; Resume then arms the new time. Message-only edits preserve those markers. Clone copies the selected schedule into a new draft without its cursor or progress. Older clients that omit the schedule on Save preserve the existing setting; explicit null selects immediate sending.

Timezone offsets follow daylight-saving changes. A nonexistent local time moves forward by the clock-change gap (for example 02:30 becomes 03:30). A repeated local time uses its first occurrence, once per local date. No new Function, secret, index or scheduled job is required: deploy the updated frontend and existing marketing Functions through the normal approved deployment process.

### State consistency and dispatch

Composer controls stay disabled during mutations so a save response cannot discard text typed during the request. Status refreshes reload changed saved content only when the composer has no unsaved edits; delivery-only updates preserve the current preview and chosen test address. Reads that started before a mutation, or before a newer refresh, cannot replace the latest state. The current admin UI includes its draft in saved-test, Start and Resume requests. The server validates and compares it with the saved campaign before submitting a test or changing sending state, rejecting a stale browser message with an instruction to refresh and review. The draft parameter is optional for existing callers; their saved-test and successful-test requirements remain enforced.

If preparation fails, the campaign returns to draft. A hard timeout may prevent that cleanup; after an 11-minute lease expires, admins can retry preparation. The retry replaces any partial recipient snapshot before marking the campaign ready. The worker pages through running campaigns in creation order, and through each campaign's pending recipients before moving to a newer campaign, so queued or skipped recipients do not hide later work. If an in-flight worker observes a pause or a future sending time, it stops processing that audience and moves to the next campaign. Account-based skips recheck the campaign status and schedule transactionally, leaving recipients pending until the edited schedule is due. The admin list retains all active campaigns alongside the newest 100 campaigns.

The worker runs every five minutes in UTC, processes running campaigns oldest first, and submits at most 25 messages per invocation. Before each submission it re-reads Auth state, consent, profile/deletion guard and current active subscription plan. A Firestore transaction reads `marketingControl/global.dailyCap` (default 10), the day's `marketingDispatchDays/YYYY-MM-DD.used`, recipient and campaign state, and creates a deterministic `mail` document together with the slot reservation. Rendering uses the campaign content read in that transaction, so a worker that began before pause/edit/resume cannot submit its earlier cached text. Tests and explicit failed-recipient retries consume the same global cap. Lowering the cap below already used slots blocks further submissions until a later UTC day. A campaign may be paused or resumed. `mail/{mailId}.delivery.state` updates recipient counts idempotently; `SUCCESS` means [SMTP acceptance by the extension](https://firebase.google.com/docs/extensions/official/firestore-send-email/delivery-status), not inbox delivery or opens. Failed recipients require an admin retry. Open, click, bounce and inbox placement metrics are not collected here.

The signed `/email/unsubscribe?token=...` endpoint is public: GET only shows a confirmation form; POST changes the canonical marketing preference to false and is idempotent. The same POST supports one-click mail client requests. It does not affect transactional mail. The signing key is the bound `MARKETING_UNSUBSCRIBE_SIGNING_KEY` Secret Manager parameter. Account deletion removes recipient records and marketing mail documents by their server-owned UID marker; historical aggregate campaign counts remain without the deleted recipient's details. All marketing collections are inaccessible to clients through Firestore Rules.

Rollout requires separate approval. Before deployment, an operator must provision the signing secret, verify `updates@quantified-self.io` as an allowed sender with the existing SMTP provider, deploy Functions/Hosting/Rules/indexes, inspect desktop and phone previews, and perform a controlled-inbox test. Neither local tests nor a PR prove sender-domain authorization or inbox placement. Do not launch a live campaign without separate approval.

## Firestore template source of truth

The allowlisted template and partial catalog is in `functions/src/email/template-catalog.ts`. HTML and plaintext sources are under `functions/templates/`. Standard sender addresses, URLs, date formatting, grace-period calculation, and plan descriptions are centralized in `functions/src/email/config.ts`; numeric limits and device-sync entitlement come from `shared/limits.ts`.

The templates use escaped Handlebars expressions, responsive table layouts, plaintext alternatives, and environment-specific partials supported by the [Firebase Trigger Email extension](https://firebase.google.com/docs/extensions/official/firestore-send-email/templates). Unknown plan roles intentionally render without a benefits list.

Manual campaign templates live in the same source directory so their HTML, plaintext, URLs, and Handlebars variables receive the same local verification. They are cataloged separately from transactional templates. Running `seed-emails` or `test-emails` without `--templates` never selects a manual campaign. A controlled test can queue an explicitly named manual campaign only after copy review, for example:

```bash
npm --prefix functions run seed-emails -- --templates=coros_delivery_update
npm --prefix functions run test-emails -- controlled-inbox@example.com --project=quantified-self-io --inline --templates=coros_delivery_update
```

`mcp_connection_update` is a manually approved service notice for current Basic and Pro subscribers affected by the August 14–17, 2026 ChatGPT custom-app authentication compatibility issue. It is not a marketing campaign and must never be queued by a default or consent-based campaign job. It tells recipients with a failed connection to remove and recreate their custom ChatGPT app, then scan tools and authorize again so ChatGPT refreshes its OAuth configuration. Existing working connections and health data were unaffected. Seed it only after copy review:

```bash
npm --prefix functions run seed-emails -- --templates=mcp_connection_update
npm --prefix functions run test-emails -- controlled-inbox@example.com --project=quantified-self-io --inline --templates=mcp_connection_update
```

The reviewed bulk queue is intentionally separate from generic campaign tooling. It reads active (`active`, `trialing`, or `past_due`) Basic and Pro Stripe subscription records, deduplicates by Firebase UID, confirms the Auth account and user document are still present, excludes disabled or deletion-marked accounts, and renders the local source inline through the Trigger Email extension. It defaults to dry-run and requires the exact live recipient count before it can queue mail. It uses deterministic `mail` document IDs plus the existing cleanup-recognized `uid` marker so account deletion can remove pending mail. It queues one message at a time, 200 ms apart by default, to stay below the provider's per-second limit.

```bash
# Inspect only: prints counts by role and exclusion reason, without writing mail.
npm --prefix functions run queue-mcp-connection-update -- --project=quantified-self-io

# Queue exactly the count reported by dry-run; this is the only write mode.
npm --prefix functions run queue-mcp-connection-update -- --project=quantified-self-io --expected-recipients=COUNT --dry-run=false
```

The COROS product update presents activity and route delivery as generally available and has no per-recipient rollout variable. Broad campaigns normally require `acceptedMarketingPolicy === true`; a connected provider is not marketing consent. The explicitly approved August 2026 COROS bug-exception campaign may include a missing legacy consent field, but must still exclude `acceptedMarketingPolicy === false`, revalidate the active COROS connection immediately before queueing, and use connection-based footer copy rather than claiming the recipient opted in.

Cancellation emails and the subscription trigger share one grace deadline. `onSubscriptionUpdated` transactionally re-reads the current active subscriptions plus the user-deletion guard before changing grace state. When every active subscription is scheduled to end, it stores the latest `current_period_end + 30 days` as `scheduledGracePeriodUntil`; any continuing subscription clears that scheduled deadline. Subscription mail creation performs the same current-state and deletion-guard reads in its own transaction, preserves existing deterministic mail documents, and queues cancellation copy only for the canonical latest end when every active entitlement is ending. The expiring-reminder job uses the same aggregate rule, so it skips earlier-ending subscriptions and any user with a continuing entitlement. When paid access ends, `onSubscriptionUpdated` promotes the exact timestamp to `gracePeriodUntil`. The existing enforcement job remains a conservative fallback if subscription-event processing exhausts its retry window; changing its account-level entitlement selection is tracked separately from this email refresh.

Local verification:

```bash
npm --prefix functions test -- src/email/template-catalog.spec.ts
npm --prefix functions run render-emails -- /tmp/quantified-self-email-previews
npm --prefix functions run build
```

The template spec compiles every approved subject, HTML body, plaintext body, and partial with Free, Basic, Pro, trial, conditional-device-sync, and unknown-role examples. It validates rendered URLs, rejects unresolved variables, and pins the SHA-256 of `development_update.hbs` so an accidental byte change fails the test.

To send the local, unseeded template sources through the already-installed Trigger Email extension, use the explicit inline smoke-test mode with a controlled inbox:

```bash
npm --prefix functions run test-emails -- controlled-inbox@example.com --project=quantified-self-io --inline
```

Inline mode compiles the local subjects, HTML, plaintext, and partials before writing each message to the `mail` collection. It does not read or modify `email_templates`, and `development_update` remains excluded. The command uses Application Default Credentials and requires `--project` so the write target is explicit; authenticate with `gcloud auth application-default login` or an approved service-account impersonation flow before running it. Because inline mode bypasses the extension's Firestore template lookup and Handlebars rendering, run at least one template-based smoke test after seeding as part of the final rollout.

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
3. Seed only the refreshed Firestore templates and required partials. The default command selects the full refreshed transactional allowlist and cannot select `development_update` or any manual campaign:

   ```bash
   npm --prefix functions run seed-emails
   ```

   A narrower rollout can use a comma-separated allowlist:

   ```bash
   npm --prefix functions run seed-emails -- --templates=registration_welcome,welcome_email
   ```

4. Deploy only the functions whose email behavior changed:

   ```bash
   firebase deploy --only functions:sendRegistrationWelcomeEmail,functions:onSubscriptionUpdated,functions:checkSubscriptionNotifications,functions:previewAdminSubscriptionGift,functions:grantAdminSubscriptionGift,functions:deleteSelf
   ```

5. Queue all refreshed plan/trial variants to a controlled inbox:

   ```bash
   npm --prefix functions run test-emails -- controlled-inbox@example.com --project=quantified-self-io
   ```

6. Verify From, Reply-To, subject, plaintext alternative, links, 390px mobile layout, desktop layout, trial copy, complimentary gift copy, Free/Basic/Pro limits, grace dates, and device-sync conditions.

Do not deploy functions before the required Firestore templates and partials exist. Do not seed templates before reviewing the generated local previews.

## Help-page review

The in-app Help content covers magic-link troubleshooting, membership management, complimentary subscription-time gifts, marketing consent, and account deletion. Gift help explains that the plan, tax handling, and cancellation choice do not change and that the subscription page labels the gifted period as a complimentary extension.
