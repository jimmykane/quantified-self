# MCP Metrics and Sleep Server

## Purpose and boundary

Quantified Self exposes a hosted, read-only Model Context Protocol endpoint at `/mcp`. It lets an MCP client read the
authenticated user's persisted numeric activity metrics, ready Training-derived snapshots, and normalized sleep
summaries without granting browser or Firestore access.

The server is a Firebase Functions v2 HTTP function behind the production and beta Hosting domains. Each request uses a
stateless Streamable HTTP transport with bounded POST/JSON responses; standalone GET/SSE and DELETE sessions are not
supported. The HTTP, OAuth, projection, and metric-catalog implementation lives under `functions/src/mcp/`.

Functions pins `@modelcontextprotocol/sdk` and overrides its compatible `@hono/node-server` adapter to `2.0.11` so the
runtime does not retain the older adapter's published path-traversal advisory. Keep the initialize-request adapter test
and re-check this override whenever the MCP SDK changes.

This is an outbound user-authorized data interface, not a fitness-provider integration. It does not import provider data,
write activities, mutate Training state, or require a public `/integrations/<provider>` page.

## Public endpoints

Hosting routes these paths to `mcpApi`:

| Path | Purpose |
| --- | --- |
| `/.well-known/oauth-protected-resource` | Protected-resource metadata for `/mcp` |
| `/.well-known/oauth-protected-resource/mcp` | Path-specific metadata alias |
| `/.well-known/oauth-authorization-server` | OAuth authorization-server metadata |
| `/oauth/authorize` | Starts an authorization-code request |
| `/oauth/token` | Exchanges or refreshes an OAuth token |
| `/mcp` | Read-only MCP Streamable HTTP endpoint |

`/mcp/authorize` is the authenticated Angular consent page. Account Settings lists active MCP connections and lets the
user revoke one immediately.

## Server presentation metadata

The MCP initialize response identifies the server as **Quantified Self** and advertises two public PNG icon variants:

| Asset | Dimensions | File size | Purpose |
| --- | --- | --- | --- |
| `/assets/favicons/android-chrome-96x96.png` | 96 x 96 | 3.3 KB | Compact ChatGPT upload and MCP client metadata |
| `/assets/favicons/android-chrome-192x192.png` | 192 x 192 | 9.9 KB | Higher-density ChatGPT upload and MCP client metadata |
| `/assets/favicons/android-chrome-512x512.png` | 512 x 512 | 47.8 KB | High-density MCP client metadata only |

All three files must remain public, square transparent PNGs. The 96px and 192px assets stay below ChatGPT's current 10 KB
icon-upload limit; the 512px asset is intentionally advertised only in MCP metadata. MCP clients may render the metadata
automatically, but rendering is optional; the Account MCP setup card and Help page therefore also offer direct downloads
for ChatGPT's manual icon upload. Keep the metadata, both download links, and the focused MCP/frontend tests aligned
whenever any asset changes.

## OAuth and authorization

The server implements OAuth authorization code with PKCE S256 and refresh-token rotation. It supports:

- `metrics:read` for event metrics and ready Training-derived snapshots;
- `sleep:read` for redacted sleep sessions and sleep summaries.

The `resource` value and token audience must exactly match the public `/mcp` URL. The authenticated Firebase UID is bound
to server-side token records; a UID is never accepted from MCP input. OAuth access tokens are opaque, are stored only as
SHA-256 hashes, expire after one hour, and are audience-bound. Refresh tokens expire after 30 days and rotate on use.
When a refresh request narrows the connection grant, previously issued access tokens with broader scopes stop working.
Reuse of an already-rotated refresh token revokes the connection and makes active descendant tokens unusable.
Authorization codes are single-use and expire after five minutes. A valueless OAuth `state` parameter is treated as
omitted; otherwise `state` must be 1–512 visible ASCII characters and is echoed exactly.
The token endpoint accepts UTF-8 `application/x-www-form-urlencoded` request bodies only and rejects repeated
parameters.

Public clients are described by HTTPS Client ID Metadata Documents. Metadata loading rejects redirects, oversized
responses, private or loopback metadata hosts, unsupported grant types, and redirect URIs that were not registered.
Loopback HTTP is allowed only for the client's redirect URI and is called out in the consent UI.
Before any client-metadata DNS lookup or HTTPS fetch, authorization starts consume transactional fixed-window limits keyed
by a hash of the Client ID Metadata URL and a separate hash of the Cloud Functions requester address. The rate-limit
documents never store either raw value and expire through the existing OAuth TTL policy.

Firestore holds short-lived OAuth records in:

- `mcpOAuthAuthorizationRequests`;
- `mcpOAuthAuthorizationCodes`;
- `mcpOAuthAccessTokens`;
- `mcpOAuthRefreshTokens`; and
- `mcpOAuthRateLimits`.

Active connection metadata lives at `users/{uid}/mcpConnections/{connectionId}`. Browser Firestore access to every MCP
collection is denied; authenticated, App Check-protected callables mediate consent, listing, and revocation. Revocation
transactionally rechecks account-deletion state before changing the connection, then deletes active tokens and codes.
Bearer authentication performs the same account-deletion check before recording usage or running a tool, while account
deletion recursively removes connection and OAuth state. OAuth cleanup reads at most 51 documents per page, deletes at
most 10 document roots concurrently, and caps one trigger attempt at 250 deletions. The Auth deletion trigger continues
mail, provider-identifier, and queue cleanup if that bounded pass fails or has more work, then fails retryably so Firebase
durably invokes the idempotent cleanup again. All short-lived MCP collections use `expireAt` TTL configuration in
`firestore.indexes.json`.

## Consent-page browser policy

Firebase Hosting applies identical dedicated headers to the exact `/mcp/authorize` and `/login` SPA entry points on
both production and beta. Header matching happens before either route is rewritten to `index.csr.html`. Both routes are
deliberately absent from the Angular service worker's `navigationUrls`, so a controlled navigation fetches the current
document and headers instead of a cached app shell. This also covers Firebase's production sign-in redirect, which can
reload `/login` before client-side navigation returns to consent. Treat the result as a policy for the full browser
lifetime, not only the consent component: later client-side navigation keeps it until the document reloads.

The enforced Content Security Policy intentionally starts with the high-confidence structural directives:

```text
base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'
```

`X-Frame-Options: DENY` provides legacy clickjacking protection, `X-Content-Type-Options: nosniff` prevents MIME
sniffing, and `Referrer-Policy: strict-origin-when-cross-origin` prevents the authorization path and request ID from
leaking to cross-origin services while retaining the site origin needed by URL-restricted Mapbox tokens.
A fuller source allowlist is present as `Content-Security-Policy-Report-Only`. It covers the same-origin app plus the
specific Firebase, Google authentication/reCAPTCHA, Mapbox, analytics, and Sentry origins the SPA currently uses. It
does not use `unsafe-eval` and declares `script-src-attr 'none'`; violations are reported rather than blocked during
this rollout stage. The source is already compatible: the theme bootstrap is a same-origin asset and Angular template
bindings implement UI event handlers instead of inline event attributes.
The narrower `wasm-unsafe-eval` source is present because the app uses Mapbox Standard Style WebAssembly; it does not
permit JavaScript string evaluation.

In browsers, the shared AI Insights response contract configures Zod with `jitless: true` before constructing its first
object schema. Zod v4 otherwise probes JavaScript string evaluation when object schemas initialize. Keep that browser
configuration before schema construction, or remove the dependency on the probe, rather than adding general
`unsafe-eval` permission. Server-side validation retains its existing JIT behavior.

Production and beta builds keep Angular's `optimization.styles.inlineCritical` disabled. The optimizer otherwise emits
an inline stylesheet `onload` handler into `index.csr.html`, which is incompatible with `script-src-attr 'none'`.
If that build setting changes, inspect the generated shell and preserve strict-script compatibility without adding
general `unsafe-inline` script permission.

`style-src 'unsafe-inline'` remains in the candidate policy because the statically hosted Angular application inserts
runtime component styles and Hosting cannot mint a fresh per-response nonce. Do not add a fixed nonce: a reusable nonce
does not provide the protection of a request-specific nonce. Revisit this only with an architecture that can supply a
fresh nonce to both the response policy and Angular.

The report-only policy currently reports to browser developer tools; there is no server-side CSP report collector.
Before moving its source directives into the enforced policy:

1. deploy this change to beta in the normal, separately approved release workflow;
2. start from a real `/oauth/authorize` request and exercise signed-out login, Firebase authentication, consent details,
   approve, cancel, and the client redirect;
3. in the same tab, exercise Firestore/callable access, App Check/reCAPTCHA, a Mapbox view, analytics, and error reporting
   so client-side navigation is covered;
4. review every `Content-Security-Policy-Report-Only` browser violation and add an origin only when a repository feature
   and observed request justify the narrowest source;
5. repeat with no unexplained violations, then enforce the candidate policy on beta first; and
6. repeat the flow on beta before applying the same enforced policy to production.

Keep the `/mcp/authorize` and `/login` header entries identical across production and beta, and keep both routes out of
the service worker navigation fallback. When a frontend dependency introduces a new network, frame, worker, image, or
script origin, update the report-only allowlist and its Hosting regression test in the same change. See the
[Angular CSP guidance](https://angular.dev/best-practices/security#content-security-policy),
[Firebase Hosting header configuration](https://firebase.google.com/docs/hosting/full-config#headers), and
[reCAPTCHA CSP allowlist](https://developers.google.com/recaptcha/docs/faq#im_using_content-security-policy_csp_on_my_website_how_can_i_configure_it_to_work_with_recaptcha).
The analytics and map entries follow the
[Google Analytics CSP guidance](https://developers.google.com/tag-platform/security/guides/csp#google_analytics_4) and
[Mapbox GL JS CSP requirements](https://docs.mapbox.com/mapbox-gl-js/guides/security-and-testing/#using-csp-directives-with-mapbox-gl-js).

## Tool contract

| Tool | Scope | Result |
| --- | --- | --- |
| `list_metrics` | `metrics:read` | Persisted numeric Sports Lib event metrics, derived kinds, and sleep capabilities |
| `query_metric` | `metrics:read` | One event-stat aggregation by local date interval or activity type |
| `get_training_metric` | `metrics:read` | One ready, redacted Training-derived snapshot |
| `list_sleep_sessions` | `sleep:read` | Paginated redacted normalized session summaries |
| `query_sleep_summary` | `sleep:read` | Day/week/month sleep aggregates in an explicit timezone |

Every tool is annotated read-only, non-destructive, idempotent, and closed-world. The HTTP layer checks the required scope
before the tool call, and only registers tools covered by the bearer token.

## Sports Lib metric discovery

`metric-catalog.ts` enumerates public Sports Lib `DataStore` classes. A metric is eligible only when:

1. the class has a stable canonical type;
2. constructing it with a numeric sentinel produces a finite numeric value;
3. its validator accepts that numeric value;
4. aliases resolve through `DynamicDataLoader`; and
5. the canonical stat appears in a non-benchmark persisted event `stats`.

This is intentionally not a curated MCP metric list. A correctly exported and persisted new numeric Sports Lib data class
becomes discoverable without adding a second registry. Latitude and longitude remain explicitly excluded because they
expose precise position.

`query_metric` imports stored event JSON through `EventImporterJSON` and reuses the shared event-stat aggregation engine.
It excludes benchmark-merge events and accepts an explicit IANA timezone for date buckets. Existing non-MCP callers keep
their prior local-time behavior when they omit the timezone.

When a Sports Lib metric is added or changed:

1. follow `.agent/skills/mcp-metric-surface/SKILL.md` and
   `.agent/skills/sports-lib-upgrade-and-reparse/SKILL.md`;
2. verify the class is public in `DataStore`, canonical through `DynamicDataLoader`, numeric, and persisted;
3. update both root and Functions to the exact same published Sports Lib version;
4. decide whether historical source files need the existing reparse lifecycle;
5. keep sensitive coordinate-like data explicitly excluded; and
6. update automatic-discovery, alias, persistence, and query tests.

The separate Sports Lib repository owns data-class semantics and parsers. Quantified Self owns availability from persisted
events, privacy filtering, query bounds, and the MCP transport.

## Training-derived metrics

MCP reads only `status: "ready"` documents with the exact current schema from
`users/{uid}/derivedMetrics/{metricKind}`. Valid kinds come from `DERIVED_METRIC_KINDS`; no second MCP kind registry
exists. The response retains schema/freshness metadata but recursively removes event/activity IDs, names, labels,
identity-derived source fingerprints, and imported device/provider provenance (`sourceKey` and `previousSourceKey`) from
the payload.

Training calculation, schema, invalidation, rebuild, and extension guidance remains in
[`training-workspace.md`](training-workspace.md). Adding a kind requires its normal derived pipeline and schema work plus
an MCP redaction-contract test.

## Sleep projection

MCP reads normalized `users/{uid}/sleepSessions` documents through a Firestore field mask and creates a new allowlisted
response. The read projection includes only the provider name and fields eligible for that response; raw samples,
provider identifiers, and score components do not enter the MCP process. Session output may include provider, sleep
date, start/end time, duration, in-bed duration, nap status, stage-duration totals, normalized score value/qualifier,
and aggregate vitals. Missing optional numeric measurements remain unavailable and do not contribute zeroes to summary
averages.

It never returns provider user IDs, provider session keys, callback URLs, provider-specific fields, score components, raw
stage intervals, raw HRV samples, raw SpO2 samples, raw respiration samples, or the Firestore document ID. Adding a sleep
provider or field therefore does not automatically expose it: update the safe projection and negative redaction tests
deliberately.

## Bounds and operational controls

- Event and sleep date ranges are at most 366 days.
- An event metric query reads at most 25 events per Firestore page and rejects matches above 2,000 events, more than
  4 MiB of cumulative serialized event stats, or more than 20,000 cumulative top-level stat entries.
- Sports Lib import begins only after those cumulative budgets pass and receives only the requested metric plus the
  activity-type stat needed for filtering.
- A sleep summary rejects matches above 1,000 sessions.
- Sleep pages are at most 100 sessions and use a per-connection encrypted cursor that does not expose the Firestore
  document ID used to resume pagination.
- Metric discovery scans the latest 500 event documents, excludes benchmark merges, and reports whether the scan was
  truncated.
- Each MCP connection is limited to 120 authorized MCP HTTP requests per minute through a distributed Firestore counter.
- Public authorization starts are limited before client-metadata retrieval to 10 per client ID and 30 per requester
  address per minute.
- Requests require valid IANA timezones where local date bucketing is relevant.
- Logs must not contain bearer tokens, authorization codes, client payloads, event data, sleep data, or user IDs.

## Local verification and release

Use the Functions emulator and local Angular app for the OAuth/consent flow. At minimum run:

```bash
npm --prefix functions test -- src/mcp
npm --prefix functions run build
npx vitest run src/app/components/mcp-authorization/mcp-authorization.component.spec.ts \
  src/app/components/mcp-connections/mcp-connections.component.spec.ts
npm run test:rules
npx tsc --noEmit -p src/tsconfig.app.json
git diff --check
```

Production rollout is deliberately separate from implementation. Deploy Firestore indexes/TTL and rules, the MCP HTTP
and callable Functions, and Hosting rewrites only after reviewing the target Firebase project. Verify discovery metadata,
OAuth login/consent, scope denial, token refresh/rotation, revocation, query limits, timezone/DST behavior, redaction, and
account cleanup before enabling clients.
