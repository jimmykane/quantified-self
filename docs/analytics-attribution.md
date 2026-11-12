# Analytics collection and attribution

## Collection boundary

The Analytics provider in `src/app/app.module.ts` initializes the Firebase Analytics SDK through
`initializeProductionAnalytics` in `src/app/helpers/analytics-runtime.helper.ts`.
Initialization requires all of the following:

- a browser runtime;
- a production build with both `beta` and `localhost` false;
- the exact HTTPS origin `https://quantified-self.io`, including the default port.

Local, LAN, beta, preview, Firebase hosting aliases, and prerender runtimes receive a null Analytics provider.
This blocks automatic first page views as well as custom events and screen/user tracking. A production bundle
served on localhost is also excluded. `forceAnalyticsCollection` cannot override this initialization boundary.
This does not change Authentication, Firestore, Performance, provider connections, or production consent behavior.

Keep the production hostname and stream filters in analytical reports even after deployment: older mixed-property
data remains, and client-side code cannot prevent another integration from sending to the same property.

## Internal context and marketing campaigns

`AppAnalyticsService.logEvent` maps the legacy application-event parameter `source` to `interaction_source`
without mutating the caller's object. An explicitly supplied `interaction_source` takes precedence. Existing
callers can continue to use their typed `source` argument; the Firebase payload contains only the renamed field.
This covers comparison navigation, history imports, connection entry points, and saved-route actions at one boundary.
It leaves event names, source-provider fields such as `source_service`, and legitimate campaign URLs unchanged.

Never use `source`, `medium`, `campaign`, or `campaign_*` to describe an internal button or workflow. Use
`interaction_source` for the entry point and reserve UTM parameters for external campaign links.

For session acquisition reports, use **Session source / medium** (`session_source_medium` in Windsor) with
session metrics. For first acquisition, use **First user source / medium** with new-user metrics. Google's
unprefixed `source` and `sourceMedium` dimensions describe key-event attribution; do not substitute them for
session dimensions. Windsor's generic `source` description currently calls it session-attributed, so use the
explicit session field instead of relying on that description. Do not join incompatible attribution dimensions
and event metrics or sum distinct-user counts across rows or days.

## Authentication, payment, and provider returns

The initial Analytics config includes `ignore_referrer: true` only for these known return contexts:

| Return page | Referring HTTPS hostname | Additional condition |
| --- | --- | --- |
| `/payment/success` or `/payment/cancel` | `checkout.stripe.com` or `billing.stripe.com` | None |
| `/subscriptions` | `billing.stripe.com` | Matches `AppPaymentService.manageSubscriptions` portal return URL |
| `/login` | `<firebase-project-id>.firebaseapp.com` | Must match the configured Firebase project |
| `/services` | `connect.garmin.com` | `connect=1` and `serviceName=Garmin API` |
| `/services` | `cloudapi-oauth.suunto.com` | `connect=1` and `serviceName=Suunto app` |
| `/services` | `open.coros.com` | `connect=1` and `serviceName=COROS API` |
| `/services` | `api.wahooligan.com` | `connect=1` and `serviceName=Wahoo API` |

On every other entry, the parameter is omitted. Do **not** set `ignore_referrer: false`: Google documents that
any supplied value suppresses the referrer. Do not blank `page_referrer`, overwrite campaign values, strip
incoming UTMs, globally ignore provider domains, or add third-party payment/authentication domains to cross-domain
measurement. A Garmin activity link to a public guide remains a normal referral.

The policy recognizes return context for measurement only. It does not validate OAuth, authorize a connection,
create a checkout, change a provider callback, or send an activity. Missing/invalid referrers retain normal
Analytics behavior; browsers may omit the referrer entirely.

### Native Stripe billing compatibility

Replacing the Stripe extension changes the server processor and callable ownership. The browser still
writes Checkout requests with `/payment/success` and `/payment/cancel`, and portal requests with
`/subscriptions`. `FUNCTIONS_MANIFEST.createPortalLink` routes the frontend's logical key to the native
`createStripePortalLink` callable in `europe-west3`. The legacy callable alias uses the same server portal
handler for cached clients. Neither callable name is a browser referrer or a return page.

The payment-service spec passes its actual generated Checkout and portal return URLs through the
Analytics initializer. It also verifies that local/beta Checkout returns cannot initialize Analytics even
when the runtime is given production build flags. Billing admission/maintenance controls, webhook
processing, and invoice/subscription projections are independent of referral filtering. Do not add
Functions or Cloud Run domains to the referral policy as part of an extension retirement.

## Onboarding flow measurement

Onboarding telemetry is frontend-only. It uses `AppAnalyticsService` and the existing production-origin and
saved analytics-consent gates. No analytics requests, collection endpoints or event writes are added to Functions.

Each primary goal has its own event-name prefix, so Windsor can distinguish flows using `event_name` without
registering GA4 custom dimensions:

| Goal | Prefix | Expected destination |
| --- | --- | --- |
| Analyze my training | `onboarding_analyze_` | `dashboard` |
| Sync between services | `onboarding_sync_` | `pro_plans` for Starter/Basic, `connections` for existing Pro access |
| Compare device recordings | `onboarding_compare_` | `compare` or `saved_comparisons` for an explicit saved-list entry |

The suffixes are `selected`, `consent_saved`, `destination_reached` and `failed`. Each event also includes the
bounded `onboarding_goal` parameter; saved/destination events include a destination label, and failures include
`failure_stage` (`save`, `profile` or `navigation`). Exploration and other explicit return flows use separate
`explore`/`other` prefixes. Legacy connect/upload choices are grouped with the visible Analyze option. No account
IDs, file data, return URLs, request IDs or selected Stripe price IDs are included in these events.

Selection is recorded once per goal per mounted setup view, only when analytics consent already exists. For
first-time opt-in, the selected goal is recorded after the authoritative profile confirms saved preferences.
The acknowledgement must match the submitted optional preferences as well as required policies and completion.
An opt-out awaiting acknowledgement, or a failed opt-out save, cannot emit a failure event using older consent.
No pre-consent history is transmitted or persisted as a queue. People who decline analytics are not measured;
the resulting funnel must not be described as conversion for all signups or abandonment before consent.

`destination_reached` and the legacy `tutorial_complete` are emitted only after navigation completes and the final
route and intended setup parameters match. A cancelled navigation, guard redirect back to setup/login or lost
Sync hint records failure, never completion. A different signed-in account cannot inherit the completion event.
An already-complete account automatically leaving onboarding emits no flow events, including when its redirect
fails. Account checks use both the component profile and the current Auth account before resuming a saved setup.
Completion means the destination route activated, not that checkout, provider connection or a comparison succeeded.

For Windsor, use the production hostname and stream, `event_name`, `event_count` and `totalusers`; compare the
three prefixes and their destination suffixes. Event counts include retry attempts; distinct users across events
are not an ordered same-session conversion cohort. The `onboarding_goal`, `destination` and `failure_stage`
parameters can additionally be registered as event-scoped dimensions after reviewing existing GA4 definitions,
but no administrative setting is changed by this code. Normal GA4 processing delays still apply.

## GA4 administration and rollout

No GA4 administrative settings are changed by this code. Windsor currently exposes reporting reads and no GA4
write actions. Inspect current stream settings in the authenticated GA4 admin UI before proposing a settings edit;
preserve existing values and obtain specific approval before saving production changes.

After the code is deployed, an optional event-scoped custom dimension makes `interaction_source` available in
native reports: **Admin → Custom definitions → Create custom dimension**, name **Interaction source**, scope
**Event**, event parameter **interaction_source**. Review existing definitions first to avoid duplicates. Updating
dependent dashboards/custom-dimension mappings is separate from emitting the parameter.

Use **Admin → Data streams → Production → Configure tag settings → List unwanted referrals** to inspect any
existing payment/auth return exclusions. The code deliberately uses path-scoped handling, so do not add blanket
provider exclusions without checking whether those hosts also produce legitimate acquisition traffic. Do not
activate destructive data filters or remove historical events as an attribution repair.

Merge and deployment remain separate approval-gated actions. From a verified checkout, the manual hosting-only
deployment sequence is `npm ci`, `npm run build-production`, then `npx firebase deploy --only hosting:production`.
Record the actual deployment time as the attribution cutover. A prepared PR or successful build is not a deployed fix.

Post-deployment verification:

1. On local/beta/preview, verify there is no Analytics SDK initialization or `g/collect` traffic. Keep automated
   regression tests independent of live Analytics; use mocked initialization and synthetic URLs.
2. On production, confirm an ordinary external referral/UTM landing keeps its campaign information.
3. Trigger an internal navigation and verify the outgoing event contains `interaction_source`, never `source`.
4. Confirm the known auth/payment/provider return config sets `ignore_referrer` only in the table's contexts.
   Use an approved test account for any real checkout or provider action; do not perform a live charge to test telemetry.
5. Re-query processed GA4 data after the normal processing delay, using production hostname **and** stream filters,
   explicit session dimensions, and a post-cutover window. Check non-production host leakage, new internal-label
   source assignments, and return-host source assignments separately. Recheck genuine external referrals as a guardrail.

Historical sessions and first-user acquisition cannot be reassigned reliably from these aggregate reports. Existing
attribution/lookback state can also keep earlier unwanted referrals visible after a prospective fix. Keep the old
baseline marked contaminated; do not relabel suspect sessions as direct or claim channel ROI/paid conversion lift
from this change. Reconcile invoice-paid outcomes separately from subscription/trial events.

## Verification and references

The pure runtime/payload spec runs in `helpers-node`; service specs retain Angular dependency-injection coverage.
Run the affected specs, frontend configuration/workflow/policy guards, and `npm run build-production` before release.
Review of the Help page found no new user control or workflow to explain; operational attribution guidance belongs here.

- [Google Analytics dimensions and metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)
- [Google Analytics configuration fields](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
- [Google's unwanted-referral guidance](https://support.google.com/analytics/answer/10327750)

Keep production data exports and source-query receipts outside this repository.
