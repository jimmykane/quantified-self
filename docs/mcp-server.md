# Read-only MCP Server

## Purpose and boundary

Quantified Self exposes a hosted, read-only Model Context Protocol endpoint at `/mcp`. It lets an MCP client read the
authenticated user's persisted numeric activity metrics, first-class body-measurement history, ready Training-derived
snapshots, normalized sleep summaries, explicitly authorized individual activity details, and saved-route previews
without granting browser or Firestore access.

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

`/mcp/authorize` is the authenticated Angular consent page. The **Connections > MCP** tab lists connections only after
the client successfully exchanges its authorization code for credentials, and lets the user revoke one immediately.

## Public discovery and indexing

The crawlable product overview lives at `/features/mcp-server`. It is a prerendered public page with route metadata,
canonical metadata, visible capability and boundary copy, FAQ structured data, and links to the setup and policy
details. `/help#data-and-privacy` owns the user setup instructions, while `/policies#mcp-clients` owns the complete
disclosure.

The protocol endpoint, OAuth endpoints, well-known metadata endpoints, and authenticated `/mcp/authorize` consent page
must never be added to the sitemap. Keep them disallowed in `src/robots.txt`, and keep consent route metadata set to
`noindex, nofollow`. When MCP scopes, tools, location behavior, projections, or supported data categories change, update
the feature page, Help, Policies, sitemap `lastmod`, prerender/startup registries, and focused content/hosting tests in
the same change.

## Server presentation metadata

The MCP initialize response identifies the server as **Quantified Self** and advertises two public PNG icon variants:

| Asset | Dimensions | File size | Purpose |
| --- | --- | --- | --- |
| `/assets/favicons/android-chrome-96x96.png` | 96 x 96 | 3.3 KB | Compact ChatGPT upload and MCP client metadata |
| `/assets/favicons/android-chrome-192x192.png` | 192 x 192 | 9.9 KB | Higher-density ChatGPT upload and MCP client metadata |
| `/assets/favicons/android-chrome-512x512.png` | 512 x 512 | 47.8 KB | High-density MCP client metadata only |

All three files must remain public, square transparent PNGs. The 96px and 192px assets stay below ChatGPT's current 10 KB
icon-upload limit; the 512px asset is intentionally advertised only in MCP metadata. MCP clients may render the metadata
automatically, but rendering is optional; the Connections MCP tab and Help page therefore also offer direct downloads
for ChatGPT's manual icon upload. Keep the metadata, both download links, and the focused MCP/frontend tests aligned
whenever any asset changes.

## OAuth and authorization

### Android client handoff

The authenticated consent page detects Android browsers and warns before approval that the exact client-supplied return
address may open in the installed client app. If ChatGPT opens but does not resume its custom-app flow, it does not
exchange the authorization code and the pending connection never becomes active. Connections > MCP and Help recommend
desktop web setup first. They also document the optional Android workaround of temporarily disabling ChatGPT's
**Open supported links** handling, retrying the complete browser flow, and restoring the setting afterward.

Quantified Self must continue redirecting to the exact validated OAuth return address. Do not rewrite the callback,
introduce a Quantified Self redirect trampoline, or claim that the server can control Android App Links or client-app
behavior.

The server implements OAuth authorization code with PKCE S256 and refresh-token rotation. It supports:

- `metrics:read` for event metrics, ready Training-derived snapshots, and selected per-activity metrics when
  `activity-details:read` is also granted;
- `measurements:read` for bounded identity-free first-class body-measurement history;
- `sleep:read` for redacted sleep sessions and sleep summaries;
- `activity-details:read` for bounded activity summaries with optional exact start/end coordinates, start/end proximity
  searches, laps, swim lengths, and MTB jumps; and
- `routes:read` for saved-route summaries, preview geometry, preview proximity searches, and waypoints.

The scopes remain independent grants. Existing metric or sleep connections do not acquire activity-detail or route
access automatically; the client must start a new authorization request and the user must approve the requested scope.
Activity-detail consent
states that activity starts, ends, and individual jumps can include exact coordinates that may reveal a home, workplace,
frequent trailhead, or other sensitive location. Saved-route consent states that route bounds, simplified geometry, and
waypoint coordinates can expose exact locations. Consent also states that place-name proximity searches send only the
supplied location text to Mapbox for forward geocoding, while direct-coordinate searches do not call Mapbox.

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

Connection metadata lives at `users/{uid}/mcpConnections/{connectionId}` and follows `pending -> active -> revoked`.
Approval creates a pending record whose `expireAt` matches the five-minute authorization-code expiry. The successful
code-exchange transaction creates the credentials, changes the connection to active, stamps `lastUsedAtMs`, and removes
`expireAt` atomically. Connections lists active records only. For compatibility, pre-lifecycle records with a non-null
`lastUsedAtMs` remain active, while old unexchanged records with no usage are hidden. Firestore TTL removes new abandoned
pending records. A mixed-version rollout is also recoverable: a pending record with completed-exchange usage evidence is
treated as active, and the next authorized request or refresh removes its stale TTL. Connection documents have no
descendant collections by design.

Browser Firestore access to every MCP collection is denied; authenticated, App Check-protected callables mediate
consent, listing, and revocation. Revocation transactionally rechecks account-deletion state before changing the
connection to revoked, then deletes active tokens and codes. Bearer authentication requires an active connection and
performs the same account-deletion check before recording usage or running a tool, while account deletion recursively
removes connection and OAuth state. OAuth cleanup reads at most 51 documents per page, deletes at most 10 document roots
concurrently, and caps one trigger attempt at 250 deletions. The Auth deletion trigger continues mail,
provider-identifier, and queue cleanup if that bounded pass fails or has more work, then fails retryably so Firebase
durably invokes the idempotent cleanup again. All short-lived MCP records use `expireAt` TTL configuration in
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
| `list_measurement_types` | `measurements:read` | Supported first-class body-measurement types, units, aggregations, intervals, limits, and current-snapshot guidance |
| `query_measurements` | `measurements:read` | Identity-free day/week/month body-measurement history and a bounded change summary |
| `list_metrics` | `metrics:read` | Persisted numeric Sports Lib event metrics, derived kinds, and sleep capabilities |
| `query_metric` | `metrics:read` | One event-stat aggregation by local date interval or activity type |
| `get_training_metric` | `metrics:read` | One ready, redacted Training-derived snapshot |
| `get_activity_metrics` | `metrics:read` + `activity-details:read` | Up to 25 explicitly selected canonical numeric Sports Lib metrics for one referenced activity |
| `list_sleep_sessions` | `sleep:read` | Paginated redacted normalized session summaries |
| `query_sleep_summary` | `sleep:read` | Day/week/month sleep aggregates in an explicit timezone |
| `list_activities` | `activity-details:read` | Paginated safe activity summaries with optional exact start/end coordinates, opaque references, and signed-in app links |
| `find_activities_near_location` | `activity-details:read` | Bounded newest-first scan matching an activity's exact start or end coordinate against a radius |
| `list_activity_laps` | `activity-details:read` | Paginated allowlisted lap timing and performance fields |
| `list_activity_jumps` | `activity-details:read` | Paginated MTB jump measurements, including exact coordinates when present |
| `list_activity_swim_lengths` | `activity-details:read` | Paginated allowlisted pool-length and stroke fields |
| `list_routes` | `routes:read` | Paginated saved-route summaries, exact bounds, opaque references, and signed-in app links |
| `find_routes_near_location` | `routes:read` | Bounded newest-first scan measuring a location against persisted route previews |
| `get_route_geometry` | `routes:read` | Bounded persisted `polyline5` preview geometry with explicit segment endpoints |
| `list_route_waypoints` | `routes:read` | Bounded allowlisted waypoint coordinates parsed from the saved FIT/GPX source |

Every tool is annotated read-only, non-destructive, and idempotent. Tools are closed-world except the two nearby-location
tools, which are marked open-world because a place-name input can call Mapbox. The HTTP layer checks every required scope
before the tool call, and only registers tools covered by the bearer token. `get_activity_metrics` is registered only
when both of its scopes are present.

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

`get_activity_metrics` reuses the same catalog and alias resolution. The request is canonicalized and deduplicated before
Firestore access, and each stored value is reconstructed through its Sports Lib data class. Only finite values accepted
by that class are returned; missing or invalid selected values are reported as unavailable. This keeps new eligible
Sports Lib numeric metrics on the same automatic surface instead of introducing a per-activity registry.

## First-class body measurements

`measurement-catalog.ts` is a deliberately narrow semantic projection layered on the automatic numeric Sports Lib
catalog. It does not decide whether a Sports Lib metric exists or is numerically valid: each entry must resolve through
`metric-catalog.ts`. It decides only which canonical metrics are safe and meaningful as personal body measurements.
Adding a numeric Sports Lib class still does not silently expose it as a body measurement.

The current first-class type is `body_weight`, backed by canonical Sports Lib `Weight` values in persisted event stats.
`list_measurement_types` describes its kilogram storage unit, median default, supported median/average/minimum/maximum/
latest aggregations, day/week/month intervals, 366-day range limit, and the optional ready
`body_weight_trend` Training snapshot, including that snapshot's separate `metrics:read` requirement and UTC day
boundary.

`query_measurements` reads the same bounded event pages as `query_metric`, excludes benchmark merges, resolves the
requested persisted value through its Sports Lib data class, rejects non-positive or non-finite body weight, and buckets
records in an explicit IANA timezone. It returns only the semantic type, canonical metric metadata, query parameters,
bucket start, aggregate value, bucket count, and first/latest change summary. It never returns the Firestore document
ID, exact source measurement timestamp, activity type, event/activity identity, name, label, provider/device metadata,
or source provenance. Multiple same-bucket values default to a median; `latest` means the chronologically latest value
inside that bucket. The capability describes these as recorded values, not a medical or health assessment.

The generic metric discovery, `query_metric`, and per-activity metric paths exclude canonical first-class measurement
types, so `metrics:read` cannot bypass the separate `measurements:read` grant. Existing clients must complete
authorization for the new scope before the measurement tools are registered. The existing `body_weight_trend` snapshot
remains the fast 28-day Training view under the pre-existing Training metric permission, not the historical measurement
API. No new Firestore collection, composite index, persistence format, reparse, or backfill is required.

To add another first-class measurement, add one explicit semantic definition backed by an already eligible canonical
Sports Lib numeric type, define its value-validity rule, supported aggregations and intervals, and user-facing meaning,
then update the tool-schema enum from the same exported ID tuple. Add positive catalog/query coverage, a negative
sensitive-field leakage test, consent/Help/Policy/feature copy, and reconsider whether the existing 366-day event-read
and 128 KiB response bounds remain appropriate. Do not infer measurement eligibility from a display name, unit, provider
payload, or arbitrary persisted stat key.

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

## Individual activity-detail projection

`activity-details:read` reads flat `users/{uid}/activities` documents through Firestore field masks. List queries select
only timestamps, activity type, power/trainer flags, the parent event reference needed to construct a signed-in app link,
the latitude/longitude leaves of the persisted `Start Position` and `End Position` stats, and a fixed set of numeric
summary stats. Detail calls select exactly one persisted array: `laps`, `events` for jumps, or `swimLengths`.
Per-activity metric calls select only `eventID` plus the requested canonical `stats.<type>` leaves. They never hydrate a
whole activity document or position map.

The response is a new allowlisted object. Summary and lap stats are limited to duration, distance, ascent/descent,
average/maximum speed, heart rate, power, cadence, and energy. Swim lengths expose only their normalized timing,
distance, pool, stroke, SWOLF, energy, speed, cadence, and heart-rate fields. Jump records expose timestamp, distance,
height, hang time, speed, rotations, score, and latitude/longitude. Activity summaries expose optional `startPosition`
and `endPosition` objects containing only validated `latitudeDegrees` and `longitudeDegrees`; missing, partial,
non-finite, or out-of-range pairs become `null`. Per-activity metric requests expose only selected finite numeric values
from the canonical Sports Lib catalog. Activity names and notes, raw streams, precise-position metrics, nonnumeric and
unrequested stats, internal ID fields, device/provider creator data, source keys, original files, nested position
metadata, and parser extensions are excluded.

Sports Lib already derives these positions from the first and last available activity position when an importer does not
provide them, and the normal activity writer persists both stats. Historical activities that do not contain a complete
stored pair return `null`; no reparse or backfill is required. Selecting the four coordinate leaves does not change the
activity query filters or ordering, so it adds no composite index.

`list_activities` returns an encrypted `activityRef`, not the activity or event document ID. References and detail
cursors use authenticated encryption and are bound to the UID and MCP connection, so another connection cannot replay
them. The separately requested direct app URL uses the existing `/user/{uid}/event/{eventId}` route and still requires
the user's normal application sign-in; it contains no MCP credential or authorization bypass.

`find_activities_near_location` reuses the same field mask and safe summary projection. It matches only the persisted
start and end positions, not the raw activity track: the response reports the nearest matching coordinate, whether it
was the start or end, and the great-circle distance. An optional paired start/end date filter retains the 366-day bound.
If dates are omitted, the scan starts with the newest activity and continues through encrypted, query-bound cursors.
Each call examines at most 100 activity documents, processes at most 512 KiB of selected summary data, returns at most
25 matches and 256 KiB, and reports whether the history scan is complete. Results preserve newest-first scan order; they
are not globally sorted by distance.

## Saved-route projection

`routes:read` lists `users/{uid}/routes` through a field mask containing the route name, timestamps, activity types,
counts, bounds, and the same fixed summary-stat allowlist. It excludes source/delivery provenance, provider IDs, Storage
metadata, creator data, route comments/descriptions/links/extensions, streams, and arbitrary stats. Route references and
cursors use the same UID-and-connection-bound authenticated-encryption design as activity references.

`get_route_geometry` reads only the persisted Sports Lib route preview. The response fixes the contract to preview
version 1, `polyline5`, precision 5, exact bounds, at most 20 segments and 5,000 decoded preview points. Segment IDs and
names are excluded. Each segment includes explicit `startPosition` and `endPosition` values derived from the first and
last decoded preview point. This is the deliberately simplified preview, not the source route's raw point stream.

`find_routes_near_location` first uses each route's persisted exact bounds as a cheap exclusion check, then reads only
the `preview` field for plausible candidates. It decodes the persisted `polyline5` once and measures the nearest point
on every preview segment using spherical geometry, so a route can match anywhere along its preview rather than only at
its endpoints. Encoded segments are preflighted against their declared point counts before decoding, and invalid preview
attempts consume the same cumulative point-work budget as valid previews. The result includes the nearest point and
distance, matching segment index, and that segment's explicit start/end coordinates. One call scans at most 50
summaries, loads at most 12 previews, processes at most 1 MiB of preview JSON and 20,000 decoded points, returns at most
10 matches and 256 KiB, and continues with an encrypted query-bound cursor when any scan or geometry budget is reached.
Invalid or missing previews are skipped and counted rather than expanding the read to original route sources.

`list_route_waypoints` reads only the server-owned source metadata needed to find the saved FIT/GPX object. The Storage
read is restricted to the owning user's route path and default project bucket, streamed to a 2 MiB compressed/raw limit,
and decompressed to at most 8 MiB before Sports Lib parsing. At most 500 waypoints are accepted. Output contains only
validated coordinates, altitude, distance, route/point indexes, and a short normalized type; names, comments,
descriptions, links, extensions, raw source bytes, and track points are never returned. The direct route URL uses the
existing `/user/{uid}/route/{routeId}` page and still requires normal sign-in.

The activity list orders and ranges on `eventStartDate`; the route list orders on `importedAt`. In both cases the
document name is only a deterministic pagination tie-breaker. These query shapes use Firestore's automatic single-field
indexes, so the MCP surface adds no composite index or index configuration. All-history nearby activity scans use the
same `eventStartDate` order without a range predicate; optional bounded dates use the existing range-and-order shape.

## Nearby-location resolution

Both nearby tools accept either `{ latitudeDegrees, longitudeDegrees }` or `{ query }`, plus a radius from 100 to
500,000 metres. Direct coordinates are validated and used entirely inside Quantified Self. Place text is normalized,
limited to 20 words and 200 characters, and sent to the Mapbox Geocoding v6 forward endpoint with autocomplete disabled,
one result, and temporary (uncached) use. MCP never invokes an AI model to repair or reinterpret a failed place lookup.
The shared deterministic Mapbox adapter is also used by AI Insights, where the existing explicitly metered AI fallback
remains an AI-specific behavior.

Mapbox responses have a 5-second timeout and 64 KiB body limit. Only the resolved label, feature type, center, and valid
bounding box enter the application. Authentication, rate-limit, timeout, malformed-response, and provider failures map
to safe MCP errors without logging the query or resolved coordinates. In addition to the normal MCP connection request
limit, place-name lookups have a distributed limit of 30 per connection per minute. Their counter documents use the
existing `mcpOAuthRateLimits` collection and `expireAt` TTL lifecycle. Direct-coordinate calls do not consume that
geocoding budget.

## Training-derived metrics

MCP reads only `status: "ready"` documents with the exact current schema from
`users/{uid}/derivedMetrics/{metricKind}`. Valid kinds come from `DERIVED_METRIC_KINDS`; no second MCP kind registry
exists. The response retains schema/freshness metadata but recursively removes event/activity IDs, names, labels,
identity-derived source fingerprints, and imported device/provider provenance (`sourceKey` and `previousSourceKey`) from
the payload. For example, `body_weight_trend` is discoverable through `list_metrics` and readable through
`get_training_metric` when ready; its safe payload contains only UTC day/value points, window coverage, medians, and
change values—never source document or measurement identities.

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
- Body-measurement ranges are at most 366 days and return only day/week/month buckets. They share the event query's
  2,000-document, 4 MiB stats, and 20,000 stat-entry limits, then apply a separate 128 KiB response limit.
- An event metric query reads at most 25 events per Firestore page and rejects matches above 2,000 events, more than
  4 MiB of cumulative serialized event stats, or more than 20,000 cumulative top-level stat entries.
- Sports Lib import begins only after those cumulative budgets pass and receives only the requested metric plus the
  activity-type stat needed for filtering.
- A sleep summary rejects matches above 1,000 sessions.
- Sleep pages are at most 100 sessions and use a per-connection encrypted cursor that does not expose the Firestore
  document ID used to resume pagination.
- Activity date ranges are at most 366 days. Activity and route list pages are at most 100 entries, read only one page
  plus a continuation sentinel per call, and reject more than 512 KiB of cumulative selected data.
- Nearby activity calls scan at most 100 summaries, return at most 25 matches and 256 KiB, and can traverse all history
  only through encrypted query-bound pages.
- Nearby route calls scan at most 50 summaries, load at most 12 persisted previews, process at most 1 MiB and 20,000
  decoded preview points, and return at most 10 matches and 256 KiB.
- Lap, jump, and swim-length arrays are limited to 10,000 raw entries and 512 KiB before projection; responses are at
  most 100 entries and 256 KiB per page.
- Per-activity metric calls accept at most 25 requested types, process at most 64 KiB of selected document data, and
  return at most 32 KiB.
- Route previews are limited to 20 segments, 5,000 decoded points, and 256 KiB. Route source reads are limited to 2 MiB,
  decompression to 8 MiB, and waypoint output to 500 entries and 256 KiB.
- Metric discovery scans the latest 500 event documents, excludes benchmark merges, and reports whether the scan was
  truncated.
- Each MCP connection is limited to 120 authorized MCP HTTP requests per minute through a distributed Firestore counter.
- Place-name geocoding is additionally limited to 30 requests per MCP connection per minute; coordinate input bypasses
  Mapbox and this provider-specific counter. The geocoding counter transaction rechecks account-deletion state before
  writing, preventing an in-flight lookup from recreating MCP state after user cleanup.
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
