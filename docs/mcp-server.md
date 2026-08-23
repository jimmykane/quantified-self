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

### Internal Assistant adapter

The built-in Assistant reuses this server through an SDK `Client` and linked `InMemoryTransport`. It calls
`createMcpServer` with a fixed first-party identity, conservative coordinate-free read scopes including saved-route
summaries, and a second explicit tool allowlist. A server-owned, conversation-bound opt-in can additionally grant the
existing `activity-location:read` scope and preferred nearby-activity search tool; it never grants route-location access.
Changing that setting replaces the conversation generation, and New chat returns it to coordinate-free. It does not
call the hosted endpoint or mint OAuth credentials, but it still uses the same registration,
scope checks, input schemas, strict output schemas, projections, data-service budgets, and Sports Lib-backed catalogs.
Direct app URLs are removed before validated results reach Gemini, and generated answers cannot repeat exact opaque
references or cursors returned by the current tool calls. The separate deterministic evidence projection can still
offer a validated safe app link. The internal allowlist also includes the existing bounded activity chart catalog and
data tools. A deterministic adapter can turn supported validated MCP results into a shared Assistant chart or satellite
map payload; Gemini selects only an advertised per-turn source and series key, never values, coordinates, renderer
configuration, or titles. Coordinate-free sessions cannot request chart breadcrumbs, while the explicit existing
`activity-location:read` mode can. Saved-route geometry remains excluded. Viewing an in-app satellite map sends its
displayed tile area to Mapbox, independently of whether place-name geocoding was used. This prevents the Assistant from
becoming a parallel data or calculation API.

Assistant chart values remain in the canonical units returned by MCP. The deterministic projection retains an optional,
bounded canonical Sports Lib data type for each supported series (and for a distance-based X axis), and the Angular
renderer applies the signed-in user's current unit settings to axis labels and tooltips. This presentation metadata is
not shown to Gemini, does not change the stored canonical values, and is not part of the registered public MCP contract.

The internal adapter is implementation-only and does not alter the registered public MCP contract. Adding a public
tool or response field still requires the digest-bound lifecycle below. Every such change must also review whether the
Assistant allowlist, routing instructions, deterministic evidence, Help, policies, and tests need an update. See
`docs/assistant.md` for the exact internal boundary and maintenance checklist.

## Public endpoints

Hosting routes these paths to `mcpApi`:

| Path | Purpose |
| --- | --- |
| `/.well-known/oauth-protected-resource` | Protected-resource metadata for `/mcp` |
| `/.well-known/oauth-protected-resource/mcp` | Path-specific metadata alias |
| `/.well-known/oauth-authorization-server` | OAuth authorization-server metadata |
| `/oauth/authorize` | Starts an authorization-code request |
| `/oauth/token` | Exchanges or refreshes an OAuth token |
| `/oauth/revoke` | Revokes an access or refresh token and its connection grant |
| `/mcp` | Read-only MCP Streamable HTTP endpoint |

`/mcp/authorize` is the authenticated Angular consent page. The **Connections > MCP** tab lists connections only after
the client successfully exchanges its authorization code for credentials, and lets the user revoke one immediately.

## Public discovery and indexing

The crawlable product overview lives at `/features/mcp-server`. It is a prerendered public page with route metadata,
canonical metadata, visible capability and boundary copy, FAQ structured data, and links to the setup and policy
details. `/help#data-and-privacy` owns the user setup instructions, while `/policies#mcp-clients` owns the complete MCP
disclosure. `/privacy` and `/terms` are dedicated prerendered reviewer URLs; `/policies` is also prerendered and remains
the consolidated legal page.

The protocol endpoint, OAuth endpoints, well-known metadata endpoints, and authenticated `/mcp/authorize` consent page
must never be added to the sitemap. Keep them disallowed in `src/robots.txt`, and keep consent route metadata set to
`noindex, nofollow`. When MCP scopes, tools, location behavior, projections, or supported data categories change, update
the feature page, Help, Policies, sitemap `lastmod`, prerender/startup registries, and focused content/hosting tests in
the same change.

## Server presentation metadata

The MCP initialize response identifies the server as **Quantified Self** and advertises three public PNG icon variants:

| Asset | Dimensions | File size | Purpose |
| --- | --- | --- | --- |
| `/assets/favicons/android-chrome-96x96.png` | 96 x 96 | 3.3 KB | Compact MCP client metadata |
| `/assets/favicons/android-chrome-192x192.png` | 192 x 192 | 9.9 KB | Higher-density MCP client metadata |
| `/assets/favicons/android-chrome-512x512.png` | 512 x 512 | 47.8 KB | High-density MCP client metadata only |
| `/assets/favicons/quantified-self-chatgpt-icon-256x256.png` | 256 x 256 | 9.4 KB | Recommended manual ChatGPT upload |

All four files must remain public, square transparent PNGs. The dedicated 256px asset meets ChatGPT's preferred minimum
dimensions and stays below its current 10 KB icon-upload limit. The 512px asset is intentionally advertised only in MCP
metadata. MCP clients may render metadata icons automatically, but rendering is optional; the Connections MCP tab and
Help page therefore offer the dedicated 256px download for ChatGPT's manual icon upload. Keep the metadata, manual
download, and focused MCP/frontend tests aligned whenever any asset changes.

## Repository-local plugin

The repository includes a local marketplace package that combines the registered Quantified Self MCP app, branding,
starter prompts, and six bundled workflow skills. This is a development and local-installation surface, not a public
marketplace submission. It does not replace the hosted `/mcp` server or OAuth consent, and installing the plugin does
not authorize a user automatically. Use the repo marketplace from the ChatGPT desktop app or Codex CLI; it is not a
mobile installation path and does not publish anything to the universal plugin directory.

Committed source lives under `plugins/quantified-self/`, with the marketplace at
`.agents/plugins/marketplace.json`. `plugin.template.json`, the skills, and marketplace metadata are reusable. An
explicit build generates three ignored files: the cache-busted `.codex-plugin/plugin.json`, the account-bound
`.app.json`, and a copy of the existing public 256px icon. The ChatGPT technical app ID is machine/account-specific. It
must come from `QS_CHATGPT_APP_ID` or the ignored `.local/quantified-self-plugin.json`; it is never committed, placed in
the manifest template, or printed by the tooling. OAuth tokens and client secrets are not accepted or stored.

The bundled skills divide ownership deliberately:

| Skill | Responsibility | Primary permission |
| --- | --- | --- |
| `analyze-quantified-self` | Comparisons that need two or more data domains | Every domain used by the comparison |
| `analyze-quantified-self-training` | Training load, volume, performance trends, and Training-derived metrics | `metrics:read` |
| `analyze-quantified-self-sleep` | Sleep sessions, stages, duration, safe aggregate vitals, naps, and sleep-oriented trends | `sleep:read` |
| `analyze-quantified-self-measurements` | Recorded body-measurement history and trends | `measurements:read` |
| `analyze-quantified-self-activity` | Individual activities, subrecords, metrics, charts, and optional locations | `activity-details:read`; optional metric/location grants |
| `explore-quantified-self-routes` | Saved-route summaries, geometry, waypoints, and nearby searches | `routes:read`; optional `route-location:read` |

All six skills allow implicit or explicit invocation and declare the same hosted read-only MCP dependency. Their trigger
descriptions keep single-domain work out of the cross-domain skill. Each `agents/openai.yaml` owns one matching
skill-level starter prompt; the plugin manifest retains only three representative interface prompts because that field
is intentionally bounded. Skills discover the authenticated server's live tools and catalogs rather than copying tool
names or metric IDs, so OAuth remains the authority for which tools are visible.

The tooling is a private package under `tools/quantified-self-plugin/`. It pins the official `@openai/codex` CLI in its
own lockfile, keeping the binary out of normal Angular installs. Dependabot proposes isolated CLI upgrades. Explicit
plugin commands bootstrap that isolated package; source validation uses its pinned YAML parser for bundled skill
metadata, while the official CLI ingestion path—not a community manifest-types package—is the installation
compatibility authority.

`BUNDLED_SKILL_NAMES` is the exhaustive source registry. Before generating account-bound files, validation requires the
source skill directory to contain exactly those six real directories and validates every frontmatter identity, UI
label, prompt reference, MCP dependency, and invocation policy. Isolated installation then compares every file in the
installed and source skill trees recursively; missing, modified, unexpected, or symlinked content fails closed.

### Initial local setup

1. Register `https://quantified-self.io/mcp` once in ChatGPT developer mode and copy the resulting technical app ID.
2. Export it for the configuration command, then store it locally:

   ```bash
   export QS_CHATGPT_APP_ID='<technical-app-id>'
   npm run plugin:configure
   unset QS_CHATGPT_APP_ID
   ```

   The command deliberately does not accept the app ID as an argument because npm echoes script arguments. To avoid
   persisting it, leave `QS_CHATGPT_APP_ID` set for later plugin commands instead of running `plugin:configure`.
3. Build, validate in a temporary Codex profile, register the repository marketplace, and install:

   ```bash
   npm run plugin:setup
   ```

4. Restart the ChatGPT desktop app if it is open, complete the normal Quantified Self OAuth flow, and test in a new
   ChatGPT or Codex conversation so the installed skill and app are loaded.

The generated local config is written with owner-only permissions where the platform supports them. Setup detects a
marketplace name or repository-root collision and fails instead of rewriting another configured source. It uses normal
`codex plugin marketplace` and `codex plugin add` commands and never edits `~/.codex/plugins/cache` directly.

### Build, validation, and refresh

| Command | Behavior |
| --- | --- |
| `npm run plugin:tools` | Installs the isolated pinned CLI package |
| `npm run plugin:build` | Generates the account-bound local bundle with one fresh `+codex.local-<UTC timestamp>` suffix |
| `npm run plugin:validate` | Installs the pinned CLI, then rebuilds, discovers, installs, and inspects the plugin using a temporary `CODEX_HOME` |
| `npm run plugin:sync` | Installs the pinned CLI, then explicitly rebuilds, validates, and reinstalls the configured local plugin |

Ordinary Angular and Functions builds do not run any of these commands and never change a developer's installed
plugins. After `plugin:sync`, restart the ChatGPT desktop app if it is open and test in a new conversation. CI supplies
a non-production fixture app ID and deterministic cachebuster, runs the generator tests, and performs the same isolated
marketplace discovery/install check. It never reads or writes a contributor's Codex profile.

### Update matrix

| Change | Required follow-up |
| --- | --- |
| Server implementation or bug fix that preserves public tools, schemas, scopes, and instructions | Deploy through the separately approved release workflow; no local plugin rebuild |
| Tool name, description, input/output schema, scope, or server instruction | Run MCP contract tests, deploy separately, rescan the registered ChatGPT developer app, and test in a new conversation |
| Plugin-only metadata, starter prompt, marketplace entry, or bundled skill | Review affected focused and cross-domain skills, update registry/fixtures when membership changes, run the official skill validators, plugin unit suite, and `plugin:validate`, then run `plugin:sync` locally |
| Shared MCP/plugin icon or branding | Run the focused MCP/frontend and plugin tests, validate and sync the local plugin, and update the registered ChatGPT developer app's uploaded icon separately; local tooling cannot change that registration |
| Replacement registered ChatGPT technical app ID | Set the new ID in `QS_CHATGPT_APP_ID`, rerun `plugin:configure`, then run `plugin:sync`; never hand-edit or commit `.app.json` |
| External Codex CLI dependency | Review the isolated dependency-update PR and pass the full plugin validation workflow |

The skills intentionally do not copy the complete MCP tool or metric catalog. They instruct the client to discover the
live authorized surface, distinguish absent data from missing permission or source availability, prefer summaries
before on-demand source parsing, preserve returned units/timezones/pagination, request location only when needed, and
avoid medical diagnosis. When a public MCP contract changes, review every affected focused skill, the cross-domain
skill when another domain may consume the result, all affected skill-level prompts, and the three manifest-level
prompts.

When adding or changing a bundled workflow:

1. Generate a new folder with the official skill scaffolder; keep only `SKILL.md` and `agents/openai.yaml` unless the
   workflow genuinely needs another resource.
2. Make its trigger metadata narrow and non-overlapping, declare exactly one hosted Quantified Self MCP dependency, and
   keep implicit invocation enabled.
3. Update `BUNDLED_SKILL_NAMES`, fixtures, integrity tests, README, and this table in the same change. The source
   directory must contain exactly the registered set.
4. Run the official validator for every skill, the plugin unit suite, dependency audit, fixture-ID
   `npm run plugin:validate`, isolated marketplace installation, forward prompts for affected and ambiguous workflows,
   and `git diff --check`.
5. Keep generated app mappings, cache-busted manifests, copied assets, local IDs, and installed plugin caches out of
   Git. Install into a real profile only through a later explicit `npm run plugin:sync`.

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
- `activity-details:read` for bounded non-location activity summaries, laps, swim lengths, MTB jump measurements,
  selected metrics, and on-demand chart series;
- `activity-location:read`, dependent on `activity-details:read`, for exact activity start/end and jump coordinates,
  nearby activity search, and chart breadcrumbs;
- `routes:read` for non-location saved-route summaries; and
- `route-location:read`, dependent on `routes:read`, for exact bounds, preview geometry, nearby route search, segment
  endpoints, and waypoints.

The location scopes cannot exist without their matching parent data scope. Consent disables a child until its parent is
selected and removes the child when the parent is removed. Authorization approval, refresh narrowing, bearer
validation, HTTP prechecks, and tool registration reject invalid child-only combinations. Activity and route location
remain independent domains. Existing clients retain non-location data but must reconnect and approve a new location
scope to regain coordinate-bearing tools. Consent explains that coordinates may reveal sensitive places and that
place-name searches send only supplied location text to Mapbox; direct-coordinate searches do not call Mapbox.

The `resource` value and token audience must exactly match the public `/mcp` URL. The authenticated Firebase UID is bound
to server-side token records; a UID is never accepted from MCP input. OAuth access tokens are opaque, are stored only as
SHA-256 hashes, expire after one hour, and are audience-bound. Refresh tokens expire after 30 days and rotate on use.
When a refresh request narrows the connection grant, previously issued access tokens with broader scopes stop working.
Reuse of an already-rotated refresh token revokes its current grant and makes active descendant tokens unusable. A replay
from an older grant generation cannot revoke a replacement grant or cancel a separately approved reauthorization.
Authorization codes are single-use and expire after five minutes. A valueless OAuth `state` parameter is treated as
omitted; otherwise `state` must be 1–512 visible ASCII characters and is echoed exactly.
The token endpoint accepts UTF-8 `application/x-www-form-urlencoded` request bodies only and rejects repeated
parameters.

Token-endpoint discovery advertises both `none` and `private_key_jwt`, while PKCE S256 remains mandatory for every
authorization-code client. Public CIMD clients such as Claude use `none`. Confidential CIMD clients such as ChatGPT
may select `private_key_jwt`; their metadata must publish `token_endpoint_auth_method: "private_key_jwt"`,
`token_endpoint_auth_signing_alg: "RS256"`, and a public HTTPS `jwks_uri`. The selected method and key location are
bound into the authorization request, code, connection, and rotating refresh family. A later metadata change therefore
cannot downgrade a newly issued confidential grant to public-client authentication. For a pre-binding code or refresh
record, its first token exchange performs one authoritative CIMD lookup before any authentication decision: a current
public client remains public, while a current confidential client must supply its private assertion and its rotated
replacement is upgraded to the private binding. Malformed legacy bindings fail closed.

Private assertions use the RFC 7523 client-assertion parameters. The server verifies an RS256 signature using only the
bound JWKS URI, requires `iss` and `sub` to equal the exact CIMD client ID, accepts only the advertised issuer or exact
token endpoint as `aud`, enforces a short bounded `exp` window plus optional `iat`/`nbf`, and limits RSA keys to at least
2048 and at most 8192 actual key bits after JWK import. It ignores assertion-provided key URLs and algorithms.
Assertion replay markers are SHA-256-derived opaque
documents in `mcpOAuthRateLimits`; they contain neither the assertion nor raw client ID and expire by TTL after the
assertion validity window. A supplied `jti` is used for replay identity; otherwise the signed assertion itself is
hashed. Invalid assertions return the same generic `invalid_client` response.

The authorization-server metadata advertises the RFC 7009 revocation endpoint and
`revocation_endpoint_auth_methods_supported: ["none"]`. Revocation intentionally remains a token-authenticated public
CIMD operation for both token-endpoint client modes: a request is a server-to-server `POST` with an
`application/x-www-form-urlencoded` body containing `token`, optional
`token_type_hint`, and the exact HTTPS Client ID Metadata Document URL in `client_id`. There is no client secret, HTTP
Basic client authentication, browser redirect, or revocation callback. Unknown token-type hints are ignored and the
lookup expands across both supported token types.

Revocation consumes fixed-window limits before credential lookup, hashes the submitted token immediately, and performs
the same two primary-key Firestore reads at the access-token and refresh-token hash document IDs. The stored token must
be unexpired and bound to the submitted `client_id`; the connection record must carry the same client ID. Rotated
refresh-token records remain bound to their family until TTL so a concurrent rotation cannot escape a revocation retry.
The endpoint validates the CIMD URL structurally but does not fetch it; the exact stored token and connection bindings
are authoritative, so a revocation request cannot trigger client-controlled DNS or HTTPS work.
Unknown, expired, already-rotated, already-revoked, and wrong-client tokens all receive the same empty HTTP 200 response
and do not reveal whether a token existed.

Clients are described by HTTPS Client ID Metadata Documents. Metadata loading rejects redirects, oversized responses,
private or loopback metadata hosts, shared-secret authentication methods, unsupported grant types, and redirect URIs
that were not registered. Private JWKS retrieval applies the same DNS resolution, public-address pinning, redirect,
five-second timeout, and 64 KiB response protections, accepts at most ten JSON Web Keys, and never follows a JWT header
URL. The public-address filter also rejects IPv4-compatible, mapped, translated, tunnelled, loopback, link-local,
documentation, multicast, and private IPv6 ranges before it opens a connection.
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
For current records, `connectionId` is a SHA-256-derived document-safe identifier over the exact verified CIMD
`client_id`. The user subcollection supplies the account boundary, giving one logical connection per account and exact
client identity without storing the client ID in a document path. Do not normalize or derive identity from the client
name, redirect host, or user agent.

The first approval creates a pending record whose `expireAt` matches the five-minute authorization-code expiry. Approval
for an existing logical connection records only the latest pending code hash and expiry; it does not change the current
status, scopes, client display metadata, grant generation, or TTL. The successful code-exchange transaction must match
that latest unexpired marker. It creates credentials, assigns a new refresh-family-backed `grantId`, replaces the
connection scopes and display metadata, changes the connection to active, stamps `lastUsedAtMs`, and removes pending
markers and `expireAt` atomically. Until that exchange commits, an existing active grant remains usable and an existing
revocation remains authoritative. Therefore failed or abandoned reauthorization cannot replace a live grant, while a
successful reauthorization invalidates the previous generation without creating a second visible connection.

Connections lists active records only. A canonical active or revoked record with `supersedesLegacy` hides and
transactionally invalidates older random-ID records for the same exact client. A canonical pending record does not
suppress a completed legacy connection, which keeps mixed-version rollouts usable until cutover succeeds. Pre-lifecycle
records with a non-null `lastUsedAtMs` remain active while no canonical suppressor exists; old unexchanged records with no
usage are hidden. Canonical active records fail closed if their `grantId` is missing, while legacy random-ID records
without a generation retain their compatibility path until superseded. Firestore TTL removes first-time abandoned
pending records and authorization-code documents; an expired marker on a live connection is inert and can be replaced
by a later approval. Connection documents have no descendant collections by design. Grant-generation, pending-marker,
suppressor, client-authentication binding, and connection-audience fields are read only through document-ID lookups and
are exempt from automatic single-field indexing; the existing `createdAtMs` ordering remains the only connection-list
query requirement. The same unqueried client-authentication maps are exempt on authorization requests, codes, and
refresh-token records; the replay marker's opaque client hash is also exempt.

Browser Firestore access to every MCP collection is denied; authenticated, App Check-protected callables mediate
consent, listing, and dashboard revocation. The list callable returns an explicit display allowlist and never exposes
`grantId`, pending-code hashes, suppressor flags, audience, status, or revocation internals. Dashboard Disconnect is an
owner-authoritative logical-client operation: it rechecks account-deletion state, clears any pending authorization
marker, preserves an existing terminal timestamp, and creates or updates the canonical revoked suppressor even when the
selected legacy row was already revoked. This makes all older duplicate records for that exact client unusable and
hidden without affecting a different CIMD client.

`/oauth/revoke` is intentionally grant-scoped. It revokes only when the submitted token belongs to the connection's
current `grantId`; an old-generation token receives the normal private HTTP 200 response but cannot revoke a replacement.
Grant-scoped token revocation and current-family refresh replay preserve a separately approved pending authorization.
The Firestore transaction conflict rules make both race orders safe: if old-grant revocation commits first, the pending
code can still activate its replacement; if code exchange commits first, the stale revocation retries against the new
generation and becomes a no-op. Owner Disconnect instead cancels both the current grant and pending replacement.

Bearer authentication and refresh rotation validate the active connection, exact client binding, canonical legacy
suppressor, scopes, and grant generation both before and inside the transactional usage write. Changing the canonical
record therefore invalidates the superseded access and refresh credentials without an unbounded query or deletion
fan-out. The hash-keyed credential documents remain inaccessible and expire through their existing TTLs; revocation
never deletes or changes the CIMD client.

Connections > MCP remains the authoritative user control because an external client may not call the revocation
endpoint when the user removes or uninstalls it. Bearer authentication performs the same account-deletion check before
recording usage or running a tool, while account deletion recursively removes connection and OAuth state. OAuth cleanup
reads at most 51 documents per page, deletes at most 10 document roots concurrently, and caps one trigger attempt at
250 deletions. The Auth deletion trigger continues mail, provider-identifier, and queue cleanup if that bounded pass
fails or has more work, then fails retryably so Firebase durably invokes the idempotent cleanup again. All short-lived
MCP records use `expireAt` TTL configuration in `firestore.indexes.json`.

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
| `query_metrics` | `metrics:read` | Up to four event-stat aggregations over one shared bounded read, date range, grouping, timezone, and activity filter |
| `list_training_metrics` | `metrics:read` | Human-readable Training metric catalog with current snapshot availability metadata but no payloads or provenance |
| `get_training_metric` | `metrics:read` | One ready, redacted Training-derived snapshot |
| `get_activity_metrics` | `metrics:read` + `activity-details:read` | Up to 25 explicitly selected canonical numeric Sports Lib metrics for one referenced activity |
| `get_activity_overview` | `metrics:read` + `activity-details:read` | Coordinate-free activity type plus actual metric, detail, and chart-source availability |
| `rank_activities_by_metric` | `metrics:read` + `activity-details:read` | Highest or lowest activities for one persisted numeric metric over an explicit bounded range or a bounded all-history scan |
| `get_sleep_trend` | `sleep:read` | One-call sleep duration, score, stage, HRV, and other safe aggregate-vital coverage and trend |
| `list_sleep_vitals` | `sleep:read` | Bounded account-specific discovery of available safe aggregate sleep vitals and their session coverage |
| `list_sleep_sessions` | `sleep:read` | Paginated redacted normalized session summaries |
| `query_sleep_summary` | `sleep:read` | Day/week/month sleep aggregates in an explicit timezone |
| `get_today_readiness` | `metrics:read` + `sleep:read` | Live Dashboard Today-equivalent readiness with Load, Sleep, HRV, and Overnight HR evidence |
| `get_daily_report` | `metrics:read` + `sleep:read` | One-call latest sleep with safe HRV/heart-rate aggregates, live readiness, and current-versus-usual Training context |
| `get_daily_briefing` | `metrics:read` + `sleep:read` | Compact timezone-aware latest completed sleep, current-versus-usual 28-day Training summary, and current UTC-day readiness status |
| `list_activity_types` | Authenticated client; no data scope | Static canonical Sports Lib activity types with group and indoor hints for activity and route filters; no account read |
| `list_activities` | `activity-details:read`; locations add `activity-location:read` | Frozen compatibility tool for bounded newest-first activity scans |
| `query_activities` | `activity-details:read`; locations add `activity-location:read` | Preferred bounded activity query with structurally exclusive explicit, relative, and unbounded date modes |
| `find_activities_near_location` | `activity-details:read` + `activity-location:read` | Frozen compatibility tool for nearby activity scans |
| `search_activities_near_location` | `activity-details:read` + `activity-location:read` | Preferred closed-world nearby activity search with structurally paired optional dates |
| `list_activity_laps` | `activity-details:read` | Paginated allowlisted lap timing and performance fields |
| `list_activity_jumps` | `activity-details:read` | Paginated MTB jump measurements; coordinates are present only with `activity-location:read` |
| `list_activity_swim_lengths` | `activity-details:read` | Paginated allowlisted pool-length and stroke fields |
| `list_activity_chart_metrics` | `activity-details:read` | Static chart metric, unit, axis, and point-limit catalog; no activity or source read |
| `get_activity_chart_data` | `activity-details:read`; add `activity-location:read` when `includeLocation` is true | On-demand bounded chart series and optional breadcrumb trace |
| `list_routes` | `routes:read` | Bounded newest-first scans with optional activity-type and case-insensitive name filters, opaque references, and signed-in app links; exact bounds require `route-location:read` |
| `find_routes_near_location` | `routes:read` + `route-location:read` | Frozen compatibility tool for nearby saved-route scans |
| `search_routes_near_location` | `routes:read` + `route-location:read` | Preferred closed-world nearby saved-route search against persisted route previews |
| `get_route_geometry` | `routes:read` + `route-location:read` | Bounded persisted `polyline5` preview geometry with explicit segment endpoints |
| `list_route_waypoints` | `routes:read` + `route-location:read` | Bounded allowlisted waypoint coordinates parsed from the saved FIT/GPX source |

Every tool is annotated read-only, non-destructive, and idempotent. The preferred `search_*_near_location` tools are
closed-world: a place-name input can make a bounded Mapbox geocoding read, but it cannot write to Mapbox or change
publicly visible internet state. The already-registered `find_*_near_location` variants retain their frozen
`openWorldHint: true` metadata for compatibility, while server instructions route new requests to the corrected
additive tools. The HTTP layer checks every required scope before the tool call and only registers tools covered by the
bearer token. `get_activity_metrics`, `get_activity_overview`, `rank_activities_by_metric`,
`get_today_readiness`, `get_daily_report`, and `get_daily_briefing` are registered only when all of their respective
scopes are present.

### Strict structured output

Every public tool has one recursively strict Zod output contract in
`functions/src/mcp/tool-output-schemas.ts`. `PUBLIC_MCP_TOOL_NAMES` and the schema registry are compile-time exhaustive:
adding or renaming a public tool without a schema fails the Functions build. The registration wrapper uses the same
schema three times:

1. `tools/list` advertises it as JSON Schema;
2. the wrapper validates the allowlisted projection before serialization; and
3. the pinned MCP SDK validates `structuredContent` again.

A successful call serializes the validated object once. That exact JSON is parsed back into canonical
`structuredContent`, and the text content carries the same JSON for clients that still consume the compatibility
fallback. This prevents optional properties with JavaScript `undefined` values from making the two representations
diverge. Undeclared fields fail closed as a generic `internal_error`; the rejected value is never returned or logged.
Expected `McpDataError` results remain text-only `isError` responses with no `structuredContent`.

Reusable schemas cover coordinates, bounds, opaque references, URLs, timestamps, pagination, metric descriptors and
units, activity stats/details, sleep values, chart series, routes, and waypoints. Objects are strict at every nested
level. The only dynamic maps are named wire concepts with constrained values, such as aggregation series and dated
Power Curve buckets. Optional means the key may be absent; nullable means the key is present but no value is available.
Historical domain timestamps are signed safe integers so valid dates before 1970 remain representable; operational
timestamps such as a Training snapshot's `updatedAtMs` remain nonnegative.
Server instructions define absolute output fields ending in `TimeMs`, `DateMs`, `DayMs`, or `AtMs`, plus
`bucketStartMs`, as Unix epoch milliseconds that must be converted exactly before a client states a calendar date.
Metric values such as HRV milliseconds and relative offsets such as jump `timestampMs` are explicitly not calendar
timestamps. A jump `timestampMs` is milliseconds elapsed from the activity start. The MCP projection normalizes current
elapsed-second values plus historical epoch-second or epoch-millisecond values against the selected activity's start.
The pending activity-ranking tool avoids that distinction for its record date by returning ISO `startTime`.
Activity and route schemas are generated for the granted scopes: parent-only variants cannot validate location fields,
and granting one location domain never widens the other.

`functions/src/mcp/derived-output-schemas.ts` defines one exact redacted payload schema for every
`DERIVED_METRIC_KINDS` value. The runtime `metricKind` refinement and advertised JSON Schema conditionals bind each kind
to its payload. Shared definitions keep the large `get_training_metric` schema and the complete 32-tool `tools/list`
response bounded. The chart metric/unit schemas derive from the same `MCP_ACTIVITY_CHART_METRICS` catalog used by the
parser implementation, so a metric and canonical unit cannot drift independently.

`functions/src/mcp/tool-output-schemas.spec.ts` connects an in-memory MCP client and server with every canonical scope,
inspects all advertised schemas, calls all 32 tools, and validates successful `structuredContent` with direct Ajv 8 and
`ajv-formats` dependencies. It also exercises all Training kinds, both chart axes, populated/empty and
continuing/terminal pagination states, nullable/optional fields, parent-only location variants, JSON-text equivalence,
expected errors, output-contract failures, and identity/provenance leakage canaries.

### Registered-contract compatibility gate

`functions/src/mcp/contracts/registered-contract.json` is the canonical contract last loaded into the registered
ChatGPT app. It is generated from real in-memory `initialize` and complete `tools/list` responses, including the
negotiated MCP protocol version, plus the protected-resource and authorization-server metadata builders. The capture
covers no-data, single-domain, dependent-location, combined activity-metric, all-parent, and all-scope grants. Identical
tool variants are content-addressed by SHA-256 so scope-specific tool visibility and instructions remain exhaustive
without copying the same large schema repeatedly. Object keys and semantically unordered schema arrays are canonicalized
before hashing.

The current baseline has lifecycle `developer`. After public publication, promote it with lifecycle `published`.
Existing tool names, authorization-profile availability, annotations, security schemes, and input/output schemas are
frozen. A pending record cannot override a breaking change. Introduce a new additive tool for a new shape, or use an
optional field that was already present in the registered schema. Additive tools, presentation metadata, instructions,
and additive OAuth capabilities require `functions/src/mcp/contracts/pending-change.json`:

```json
{
  "formatVersion": 1,
  "candidateSha256": "<candidate contract SHA-256>",
  "lifecycleAction": "developer-refresh",
  "summary": "Describe the additive metadata change.",
  "rescanRequired": true
}
```

The record is valid only for that exact candidate digest. Use `published-version` instead of `developer-refresh` for a
published baseline or when moving unchanged developer metadata into its first published version. The append-only
`functions/src/mcp/contracts/contract-history.json` records every consumed transition with its previous/current digest,
previous/current lifecycle, action, and summary. CI compares the baseline and history with the pull-request base or
previous pushed revision; rewriting history, replacing the baseline directly, or appending a record that does not join
the exact digest chain fails.

The normal workflow is:

1. Run `npm --prefix functions run mcp:contract:check`. Breaking differences always fail; compatible metadata
   differences print their candidate digest and require the matching pending record.
2. Create or update `pending-change.json` with that exact digest, the intended lifecycle action, and a concrete summary,
   then rerun `mcp:contract:check` and require it to pass.
3. Optionally write a review copy with
   `npm --prefix functions run mcp:contract:capture -- --output /tmp/quantified-self-mcp-contract.json`. Capture refuses
   to overwrite the registered baseline, transition history, or pending record.
4. Deploy only through the separately approved release workflow. For developer metadata, refresh the registered app and
   test a new conversation. For published metadata, complete scan, review, approval, and publication.
5. Promote the exact tested candidate with
   `npm --prefix functions run mcp:contract:promote -- --digest <sha256> --action developer-refresh`, using
   `published-version` when applicable. Promotion verifies compatibility and the pending record, replaces the baseline,
   appends the durable transition record, and removes the consumed pending record. This command also supports the
   lifecycle-only `developer -> published` transition when the advertised metadata itself is unchanged. Promotion writes
   history before the baseline; rerunning the same digest-bound command safely completes either interrupted write stage
   after confirming that the live MCP contract still matches.

`mcp:contract:bootstrap` exists only to create a missing first developer baseline and refuses to replace one. CI builds
Functions, fetches the comparison revision, and runs the compiled compatibility and append-only history checks before
accepting the change. A server-only implementation or result fix needs no pending record when the advertised contract
remains byte-for-byte equivalent after canonicalization.
Never edit the registered baseline or transition history directly; only the verified promotion command may update them.

The repository-managed Lefthook pre-push hook runs `npm run hooks:mcp:pre-push` only when the pushed commits touch MCP
Functions code, the contract command, or the Functions dependency manifests. The focused command runs the contract gate
and the MCP output/server tests without running the full Functions suite. The npm-installed Lefthook package normally
installs configured hooks automatically; run `npm run hooks:install` to reinstall them explicitly. This hook is an early
local check only: CI remains authoritative, and deployment, registered-app refresh/rescan, contract promotion, and local
plugin sync remain explicit lifecycle actions.

### Changing or adding a tool

1. Add or change the allowlisted data-service projection; never derive a public schema from an internal Firestore,
   Sports Lib, parser, provider, or Storage object.
2. Add the tool name to `PUBLIC_MCP_TOOL_NAMES` and define its exact strict registry entry. Reuse the named coordinate,
   reference, pagination, unit, date, activity, sleep, route, or waypoint concept when it is genuinely identical.
3. Model scope variants explicitly. A schema must omit fields unavailable to the granted scope rather than accepting
   them as optional, and an explicit coordinate request must still fail before source work when permission is missing.
4. Return the projected value through the shared registration wrapper. Preserve validated `structuredContent` and
   equivalent JSON text; keep errors text-only.
5. Update the in-memory successful fixture, Ajv assertion, empty/nullable/pagination cases, and negative leakage
   canaries. A new Training kind also needs an exact entry in `MCP_DERIVED_PAYLOAD_SCHEMAS` and its exhaustive fixture.
6. Run `npm --prefix functions test -- src/mcp/tool-output-schemas.spec.ts src/mcp/server.spec.ts`, the focused
   data-service tests, `npm --prefix functions run mcp:contract:check`, and `git diff --check`. Add the digest-bound
   pending record for a compatible metadata change; a breaking finding requires redesigning the change. Update this
   document whenever the public contract moves.

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

Sports Lib 19.0.0 adds canonical `Stroke Rate` (`spm`) metrics for swimming, rowing, canoeing, kayaking, paddling, and
stand-up paddling. Quantified Self includes that class through the same automatic catalog. For pre-19 event/activity
documents, bounded metric reads also select the matching Cadence field and canonicalize it only when every represented
activity type uses Sports Lib's stroke-rate semantics. Explicit Stroke Rate wins, and mixed or unresolved sport sets
retain Cadence. This is read compatibility, not another metric registry or a Firestore migration.

Sports Lib 19.1.0 introduced source-native dive summary classes for average/maximum depth, surface interval, bottom time,
dive number, descent/ascent/hang times, average/maximum descent and ascent rates, starting/ending CNS and N2 loads,
oxygen toxicity, average pressure/volume SAC, and average RMV. These become MCP metrics through the same automatic
catalog only when the corresponding numeric stat is actually persisted. MCP does not calculate a missing summary from
a continuous stream, promote lap-only values to an activity, or expose gas/tank records as metrics. The same FIT import
transition preserves explicit Garmin dive sub-sports as canonical Scuba Diving for single-gas, multi-gas, and gauge
diving, and Free Diving for apnea diving and apnea hunting; MCP activity-type and Diving-group filters consume those
persisted canonical values without adding another classification registry.

The package also exports unit-derived dive presentation classes for frontend meters/feet and meters-per-second/
feet-per-second display. Quantified Self persists and queries only their canonical source types, so these display-only
classes do not create additional available MCP metrics or change MCP units, values, or registered output schemas.

Sports Lib 20.0.1 adopts FIT parser 5.0.2 and adds canonical `Metabolic Calories` (`kcal`) from FIT session field
196. It becomes available through this same automatic catalog only after a source import or reparse persists that stat.
The parser no longer emits a new `Resting Calories` value for the field; an existing persisted `Resting Calories` stat
remains readable as its own historical value until a source reparse replaces its source stats, and is never renamed or
synthesized as `Metabolic Calories`. FIT `Average VAM` source values are converted from meters per second to the public
meters-per-hour metric before persistence. For the Diving group, terrain ascent/descent, altitude
minimum/maximum/average, and grade minimum/maximum/average summaries
are removed during import and native JSON hydration; raw source streams remain outside this MCP summary surface. A
retained original FIT file must use the normal targeted reparse lifecycle to gain those new or corrected persisted
values. This is an implementation/data correction within the existing generic metric schemas, so no registered MCP
tool or output-schema change is required.

Sports Lib 20.0.3 applies the same eight-metric rule whenever it regenerates a parent event summary: an all-Diving
parent omits the terrain summaries, while a mixed parent aggregates them only from non-Diving child activities. The
normal targeted source-reparse lifecycle rewrites a retained stored parent when that correction is needed; no metric
is synthesized from a stream or created by the MCP read path. For a legacy all-Diving event/activity projection,
MCP applies the same canonical semantics before metric discovery and selected-metric projection, so stale terrain
fields are neither advertised nor returned; mixed and unresolved activity sets remain unchanged. This remains within
the existing generic metric schemas, so no registered MCP tool or output-schema change is required.

Sports Lib 20.1.0 adds nonnumeric source-hydrated FIT gas, tank-summary, and tank-pressure-update records for the
frontend Event Details **Gas & Tanks** section. They are excluded from Sports Lib native JSON and are never persisted
to Firestore, discovered as metrics, or projected through any MCP activity-detail response. The records retain raw
source values only; MCP does not infer mixtures, gas-to-tank associations, or consumption. This is an implementation
and presentation change outside the registered MCP contract, so no registered MCP tool or output-schema change is
required.

`query_metric` selects only the requested canonical stat and the activity-type stat from Firestore before applying its
cumulative work budgets, imports that bounded projection through `EventImporterJSON`, and reuses the shared event-stat
aggregation engine. It excludes benchmark-merge events and accepts an explicit IANA timezone for date buckets. Existing
non-MCP callers keep their prior local-time behavior when they omit the timezone.

`query_metrics` uses the same range, paging, byte, stat-entry, filtering, import, and aggregation primitives. It accepts
one to four canonical metric/aggregation selectors, deduplicates identical selectors, fetches the bounded event range
once through a Firestore field mask containing only those stats plus activity type, and imports each eligible event
once. It then builds one result per selector with the shared grouping, interval, timezone, and activity-type filters. It
does not create a metric catalog document or any other persisted cache.

`get_activity_metrics` reuses the same catalog and alias resolution. The request is canonicalized and deduplicated before
Firestore access, and each stored value is reconstructed through its Sports Lib data class. Only finite values accepted
by that class are returned; missing or invalid selected values are reported as unavailable. This keeps new eligible
Sports Lib numeric metrics on the same automatic surface instead of introducing a per-activity registry. A selected
Stroke Rate read includes only its canonical field, the pre-19 Cadence compatibility field, and the activity type needed
to decide semantics; the compatibility field is never exposed as provenance.

`get_activity_overview` reads one reference-bound activity projection and returns only its canonical activity type,
redaction marker, the numeric metrics actually present, allowlisted lap/jump/swim-length availability,
and whether an original chart source is declared. Candidate chart metric IDs come from the existing activity-chart
catalog; the source file is not downloaded or parsed. Coordinates and raw detail records are never part of this tool.

`rank_activities_by_metric` resolves the same canonical numeric catalog, then reads only the selected activity fields and
the chosen stat in bounded Firestore pages. It returns coordinate-free opaque references and values, with deterministic
value/start-time/document ordering. Ranked results expose an explicit ISO `startTime` string rather than a
millisecond value so MCP models can cite the winning activity's recorded date without timestamp arithmetic or
substituting the current date. Callers can provide a paired explicit range of at most 366 days or omit both dates
to scan all available history. Both modes retain the 2,000-document, cumulative-byte, and response budgets; an
over-budget scan fails with `query_too_large` instead of returning a partial ranking that could be mistaken for a true
record. Explicit ranges reuse the single-field `eventStartDate` ordering plus the document-ID tie-break. An unbounded
ranking with activity filters pushes the canonical types into the Firestore `in` filter and pages by document ID, so
the processing bound applies to the relevant sport family instead of all account activities. Both shapes use existing
single-field indexes and require no new composite index. First-class body measurements remain excluded.

The optional `activityGroup` input takes an exact group value returned by `list_activity_types` and expands it through
Sports Lib's `ActivityTypesHelper`. It is combined with any explicit activity types, canonicalized, deduplicated, and
kept under the same 20-type input limit before Firestore access. This keeps sport-family membership in the shared
library instead of relying on each Assistant or MCP client to maintain its own subtype list.

MTB jump superlatives reuse this generic metric path rather than introducing a second jump-ranking store or tool.
Discover the Mountain Biking group value, pass it as `activityGroup` so the server expands every canonical type, and
select the corresponding Sports Lib maximum metric:
`Maximum Jump Distance` for biggest/longest, `Maximum Jump Height` for highest, `Maximum Jump Hang Time` for airtime,
`Maximum Jump Speed` for fastest, or `Maximum Jump Score` for an explicit score request. Rank the matching activities,
and treat the winning persisted maximum and its canonical unit as authoritative. Use `list_activity_jumps` only when the
user asks for jump-level details. When reading those records, follow `nextCursor` until `scanComplete` or state that the
inspection is incomplete; the bounded built-in Assistant does not spend its required superlative workflow on redundant
jump pagination. `jumpCount` is availability and volume evidence only; it never ranks jump quality.

For a recent or latest jump detail request, use newest-first `query_activities`, choose the first returned activity with
`jumpCount > 0`, then pass that opaque reference to `list_activity_jumps`. Continue the same query cursor only when the
page contains no activity with jumps. With `activity-location:read`, only a jump-record coordinate may represent a jump
on a map or in prose: an activity's start and end positions are distinct summary locations and must never be substituted.

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

`activity-details:read` reads flat `users/{uid}/activities` documents through Firestore field masks. Non-location list
queries select only timestamps, activity type, power/trainer flags, the parent event reference needed to construct a
signed-in app link, and a fixed set of numeric summary stats. The four persisted `Start Position`/`End Position`
coordinate leaves enter the query only when `activity-location:read` is present. Detail calls select exactly one
persisted array: `laps`, `events` for jumps, or `swimLengths`.
Per-activity metric calls select only `eventID` plus the requested canonical `stats.<type>` leaves. They never hydrate a
whole activity document or position map.

The response is a new allowlisted object. Summary and lap stats are limited to duration, distance, ascent/descent,
average/maximum speed, heart rate, power, locomotion cadence, and energy. Canonical Stroke Rate is available through
the selected numeric metric surface rather than being mislabeled in the fixed cadence summary field. Swim lengths expose
only their normalized timing, distance, pool, stroke, SWOLF, energy, speed, cadence-shaped rate, and heart-rate fields.
For swimming, the frozen `averageCadenceRpm` wire field contains the source stroke rate; its compatibility name cannot be
renamed without a registered-contract transition. Jump records expose timestamp, distance,
height, hang time, speed, rotations, and score. The jump `timestampMs` is an activity-relative elapsed offset in
milliseconds, not an epoch timestamp. With `activity-location:read`, jump records may also expose latitude/longitude,
and activity summaries may expose validated `startPosition` and `endPosition` coordinates. Without that scope,
coordinate fields are omitted and `locationRedacted` is true. Per-activity metric requests expose only selected finite numeric values
from the canonical Sports Lib catalog. Activity names and notes, raw streams, precise-position metrics, nonnumeric and
unrequested stats, internal ID fields, device/provider creator data, source keys, original files, nested position
metadata, and parser extensions are excluded.

Sports Lib already derives these positions from the first and last available activity position when an importer does not
provide them, and the normal activity writer persists both stats. Historical activities that do not contain a complete
stored pair return `null` when location access is granted; no reparse or backfill is required. Selecting the four
coordinate leaves does not change the
activity query filters or ordering, so it adds no composite index.

`list_activities` returns an encrypted `activityRef`, not the activity or event document ID. References and detail
cursors use authenticated encryption and are bound to the UID and MCP connection, so another connection cannot replay
them. The separately requested direct app URL uses the existing `/user/{uid}/event/{eventId}` route and still requires
the user's normal application sign-in; it contains no MCP credential or authorization bypass.

Activity discovery metadata explicitly maps workout, exercise-session, today, yesterday, last, latest, most-recent, and
named-sport requests to `query_activities`. `list_activity_types` returns the unique canonical Sports Lib activity types
plus their group and indoor hints; filters accept those values or aliases recognized by Sports Lib and canonicalize
them before scanning. A request such as “latest run” therefore uses a server-side type filter with `limit: 1`, so a newer
activity of another type is skipped instead of being mistaken for the requested workout.

`query_activities` is always newest first. Its advertised JSON Schema uses `oneOf` for exactly three legal date modes:
an explicit paired `start` and `end` with the existing 366-day limit; a
`relativePeriod: "today" | "yesterday"` paired with an explicit IANA `timeZone`; or an unbounded mode that omits all
four date selectors. The relative mode resolves exact local calendar-day boundaries, including DST-short and DST-long
days. Invalid partial or mixed selectors therefore fail schema validation before service work instead of relying only
on runtime validation. A relative-period cursor retains the first page's resolved millisecond range, so crossing local
midnight between pages cannot move the query window. `search_activities_near_location` similarly advertises an explicit
paired range or an unbounded mode.

One filtered call scans at most 100 selected activity documents and can return fewer matches than requested.
`scannedActivityCount`, `skippedActivityCount`, `nextCursor`, and `scanComplete` distinguish a completed no-match result
from a partial scan. Clients repeat the original activity types and date-selection inputs with `nextCursor` until a
match is found or `scanComplete` is true. The encrypted cursor is bound to the connection, canonical activity-type set,
relative-period/timezone mode, and resolved or explicit date range; the type set is represented by a fixed SHA-256
digest so the cursor remains within 512 characters even at the 20-filter maximum. Aggregate event metrics and Training
snapshots are not evidence that an individual activity is unavailable.

The nearby activity tools are not registered and Mapbox is not called without `activity-location:read`.
`search_activities_near_location` is the preferred corrected surface. With the scope, it reuses the location field mask
and safe summary projection. It matches only the persisted
start and end positions, not the raw activity track: the response reports the nearest matching coordinate, whether it
was the start or end, and the great-circle distance. An optional paired start/end date filter retains the 366-day bound.
If dates are omitted, the scan starts with the newest activity and continues through encrypted, query-bound cursors.
Each call examines at most 100 activity documents, processes at most 512 KiB of selected summary data, returns at most
25 matches and 256 KiB, and reports whether the history scan is complete. Results preserve newest-first scan order; they
are not globally sorted by distance.

## On-demand activity chart projection

`list_activity_chart_metrics(activityType?)` is a static catalog. `get_activity_chart_data` accepts one to four metrics,
an `elapsed_time` or `distance` axis, at most 400 points per metric, and an optional breadcrumb of at most 1,000 points.
The frozen catalog covers heart rate, power, cadence, altitude, grade, distance, speed, running pace, swim pace, and trail
grade-adjusted pace/speed with canonical units. Cadence is omitted for activity types whose Sports Lib semantic is
Stroke Rate so the source parser cannot silently return an empty or mislabeled series. Canonical persisted Stroke Rate
remains discoverable through `list_metrics` and the selected event/activity metric tools; adding a continuous
`stroke_rate` chart ID would be a separate registered-contract change.

Event Details has a frontend-only pinned Dive Profile for source-native Depth, decompression, CNS/N2 load, air-time,
SAC/RMV, PO₂, dive-ascent-rate, Temperature, and Heart Rate streams. Those continuous streams remain intentionally
absent from `list_activity_chart_metrics` and `get_activity_chart_data`, preserving the frozen registered MCP chart
schemas and source-stream allowlist. Persisted numeric dive summaries are governed by the automatic Sports Lib metric
catalog described above; continuous samples are not projected through MCP.

The service decrypts the connection-bound `activityRef`, reads only the target event source metadata and its bounded
activity identity set, and validates every object path under `users/{uid}/events/{eventId}/` in an approved project
bucket. It streams at most four FIT, GPX, TCX, Suunto JSON/SML, or gzip source files. Sports Lib receives only requested
streams plus derivation and axis dependencies. Multi-file events reuse `EventUtilities.mergeEvents`. The pure shared
identity matcher tries source key and then progressively narrower unique identity signatures; ambiguity fails closed.

This path never calls reparse persistence, metadata auto-healing, ID assignment, regeneration, event/activity writers,
or source writes. Parsed objects are discarded after projection. Scalar streams preserve endpoints and per-bucket
minima/maxima across the complete activity. Breadcrumb selection preserves path endpoints and aligned elapsed-time or
distance values. An explicit location request is rejected before coordinate fields, Storage, parser, or Mapbox work
unless `activity-location:read` is present.

Responses contain parallel chart arrays, canonical units, and source/returned/missing sample counts. They exclude
original files, internal IDs, source keys, provider/device metadata, parser extensions, absolute sample timestamps,
unrequested streams, and full-resolution recordings. Historical availability depends on the original source remaining
available and within budgets; no backfill or persistent cache is created.

## Saved-route projection

`routes:read` lists `users/{uid}/routes` through a field mask containing the route name, timestamps, activity types,
counts, and the same fixed summary-stat allowlist. `list_routes` can filter the bounded newest-first scan by canonical
Sports Lib activity types and/or a normalized case-insensitive substring of the route name. Each call scans at most 100
selected documents and reports scanned/skipped counts, `nextCursor`, and `scanComplete`. Clients repeat the original
filters until a match is found or the scan completes. The encrypted cursor binds the canonical activity-type set and
normalized search text to the connection through fixed SHA-256 digests, keeping the cursor within its length limit.
Bounds enter the field mask only with `route-location:read`; otherwise they are omitted and `locationRedacted` is true.
The projection excludes source/delivery provenance, provider IDs, Storage metadata, creator data, route
comments/descriptions/links/extensions, streams, and arbitrary stats. Route references and cursors use the same
UID-and-connection-bound authenticated-encryption design as activity references.

`get_route_geometry`, both nearby-route variants, and `list_route_waypoints` are not registered without
`route-location:read`, and missing permission is rejected before preview, Storage, parser, or Mapbox work.
`get_route_geometry` reads only the persisted Sports Lib route preview. The response fixes the contract to preview
version 1, `polyline5`, precision 5, exact bounds, at most 20 segments and 5,000 decoded preview points. Segment IDs and
names are excluded. Each segment includes explicit `startPosition` and `endPosition` values derived from the first and
last decoded preview point. This is the deliberately simplified preview, not the source route's raw point stream.

`search_routes_near_location` is the preferred corrected surface. It first uses each route's persisted exact bounds as a
cheap exclusion check, then reads only the `preview` field for plausible candidates. It decodes the persisted
`polyline5` once and measures the nearest point
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

The activity list orders on `eventStartDate` and applies an optional explicit or resolved relative range on the same
field; activity-type matching happens inside the bounded MCP scan rather than through another Firestore predicate. The
route list orders on `importedAt`; its activity-type and name matching also happen inside the bounded scan. In both
cases the document name is only a deterministic pagination tie-breaker. These query shapes use Firestore's automatic
single-field indexes, so the MCP surface adds no composite index or index configuration. All-history activity lists
and nearby scans use the same `eventStartDate` order without a range predicate; optional bounded dates use the existing
range-and-order shape.

## Nearby-location resolution

The preferred nearby-search tools accept either `{ latitudeDegrees, longitudeDegrees }` or `{ query }`, plus a radius from 100 to
500,000 metres. Direct coordinates are validated and used entirely inside Quantified Self. Place text is normalized,
limited to 20 words and 200 characters, and sent to the Mapbox Geocoding v6 forward endpoint with autocomplete disabled,
one result, and temporary (uncached) use. MCP never invokes an AI model to repair or reinterpret a failed place lookup.
The built-in Assistant receives no location tools by default. After the user explicitly starts a fresh chat with precise
activity locations enabled, it can use the preferred nearby-activity search. A place-name lookup then follows this same
bounded Mapbox path; direct coordinates remain internal. Saved-route location tools remain unavailable.

Mapbox responses have a 5-second timeout and 64 KiB body limit. Only the resolved label, feature type, center, and valid
bounding box enter the application. Authentication, rate-limit, timeout, malformed-response, and provider failures map
to safe MCP errors without logging the query or resolved coordinates. In addition to the normal MCP connection request
limit, place-name lookups have a distributed limit of 30 per connection per minute. Their counter documents use the
existing `mcpOAuthRateLimits` collection and `expireAt` TTL lifecycle. Direct-coordinate calls do not consume that
geocoding budget. This read-only lookup does not change public internet state, so the preferred nearby-search tools use
`openWorldHint: false`.

## Training-derived metrics

MCP returns Training snapshot payloads only from `status: "ready"` documents with the exact current schema in
`users/{uid}/derivedMetrics/{metricKind}`. Valid kinds come from `DERIVED_METRIC_KINDS`; no second MCP kind registry
exists. The response uses the frozen public wire-schema version plus snapshot freshness metadata, and recursively removes event/activity IDs, names, labels,
identity-derived source fingerprints, and imported device/provider provenance (`sourceKey` and `previousSourceKey`) from
the payload. It then validates the result against the exact schema for that `metricKind`; undeclared fields fail closed
instead of being serialized. For example, `body_weight_trend` is discoverable through `list_metrics` and readable through
`get_training_metric` when ready; its safe payload contains only UTC day/value points, window coverage, medians, and
change values—never source document or measurement identities.

Internal derived schema 18 includes the eight sport families and context/profile summaries introduced in schema 16,
the reusable maximum aggregation used for MTB longest-jump distance in schema 17, and canonical swimming, rowing, and
paddling stroke-rate profile metrics with bounded pre-19 Cadence read compatibility. The registered MCP contract maps
current snapshots to its frozen wire schema version 15 and three-family shape through an explicit projection before
redaction and strict validation:

- `training_summary` and `training_build_comparison` retain only Running, Cycling, and Swimming and reconstruct their
  exact registered window objects, so internal `contexts`, profile IDs, and profile metrics cannot leak.
- `training_explanation` retains those three named families, folds Rowing, Walking & Hiking, Nordic Skiing, Strength,
  and Paddling into Other for complete load/composition totals, and exposes rhythm only for the registered three.
- `training_durability` retains its existing Running, Cycling, Pool, and Open-water scopes.

The same projection protects the compact briefing and daily report Training summary. Negative fixtures include all
eight internal families, gravity/rowing contexts, the internal maximum-jump and stroke-rate profile metrics, and
undeclared private fields, then prove the public result validates and contains none of them. Because advertised tools, schemas,
instructions, plugin metadata, and starter prompts do not change, this internal expansion needs neither a
registered-app rescan nor a local plugin sync.

`list_training_metrics` adds presentation and routing metadata without adding another kind registry: its descriptor map
is compile-time exhaustive against `DERIVED_METRIC_KINDS`. It reads only snapshot envelope metadata for the matching
descriptors, validates the snapshot entry type and metric identity, and reports `ready`, `building`, `failed`, `stale`,
`missing`, or `schema_mismatch`. It never returns a snapshot payload, backend error text, event identity, or source
provenance. Clients should use it before deciding that a Training metric is unavailable, and call
`get_training_metric` only for a ready kind.

Training calculation, schema, invalidation, rebuild, and extension guidance remains in
[`training-workspace.md`](training-workspace.md). Adding a kind requires its normal derived pipeline, exact safe MCP
payload schema, structured-output fixture, and positive and negative redaction-contract tests.

## Sleep projection

MCP reads normalized `users/{uid}/sleepSessions` documents through a Firestore field mask and creates a new allowlisted
response. The read projection includes only the provider name, normalized timezone offset needed for Suunto readiness
date grouping, and fields eligible for the response; raw samples, provider identifiers, provider-specific timestamps,
and score components do not enter the MCP process. The fixed aggregate-vital allowlist covers average, minimum, and
resting sleep heart rate; average and overnight HRV plus HRV sample count; maximum SpO₂; and average respiration.
Garmin's maximum SpO₂ is normalized from its valid recorded sleep samples during ingestion so MCP can return the safe
aggregate without loading or exposing the source series. Non-positive Garmin respiration samples do not contribute to
its normalized average. Session output may include provider, sleep
date, start/end time, duration, in-bed duration, nap status, stage-duration totals, normalized score value/qualifier,
and aggregate vitals. Missing optional numeric measurements remain unavailable and do not contribute zeroes to summary
averages. The lower-level `list_sleep_vitals` reports only the safe vital types that have at least one recorded session in the
requested bounded period, their units, and session coverage. It lets clients discover HRV before querying nightly or
grouped values without returning readings, raw samples, provider identity, or source provenance in the discovery result.
`get_sleep_trend` is the preferred one-call path for recent sleep or recovery-oriented questions. It returns the exact
requested range, IANA timezone, grouping, recorded-vital coverage, and the same safe duration, score, stage, and
aggregate-vital buckets as the lower-level summary path. The implementation performs one bounded projected read and
cannot diagnose illness or infer missing physiology. An individual session's SpO₂ aggregate is its maximum; a grouped
bucket's value is the average of the contributing session maxima. Grouped respiration likewise averages the
contributing session-level averages. Grouped HRV sample counts are averaged across contributing sessions and rounded to
the nearest whole sample so the value retains the registered integer-count contract.

The trend and lower-level summary now call one shared normalized sleep loader and aggregation path, so HRV, sleep heart
rate, SpO₂, respiration, stage, and duration values cannot drift between those tools. The daily report continues to use
the same normalized sleep fields and safe value rules for its allowed latest-night HRV and heart-rate fields. Missing
physiology stays absent/null and is never converted to zero. Server and bundled-skill instructions explicitly route
multi-day physiology questions to `get_sleep_trend` and availability-only questions to `list_sleep_vitals`.

It never returns provider user IDs, provider session keys, callback URLs, provider-specific fields, score components, raw
stage intervals, raw HRV samples, raw SpO2 samples, raw respiration samples, or the Firestore document ID. Adding a sleep
provider or field therefore does not automatically expose it: update the safe projection and negative redaction tests
deliberately.

## Current readiness and daily report projections

### Live today readiness

`get_today_readiness` is the one-call source for the current recovery-aware score and requires both `metrics:read` and
`sleep:read`. It deliberately does not widen the frozen daily-briefing output. The caller supplies an IANA timezone for
local-day context, while the score retains the Dashboard and Training UTC-day boundary.

The tool reads exactly the ready `form`, `form_now`, and `ramp_rate` snapshot documents plus one bounded 30-day,
readiness-only sleep projection. That dedicated Firestore field mask reads only provider grouping, sleep date,
start/end/duration, normalized timezone offset, nap state, score value, aggregate average/overnight HRV, and aggregate
average/minimum sleep HR; it does not materialize stages, score qualifiers, SpO₂, respiration, or other sleep fields.
The tool rebuilds the current zero-load decay series from Form's persisted daily loads and prefers its current Form and
seven-day CTL ramp, using the current-day compact snapshots only for a value the series cannot supply. This is the same
source-selection contract as Dashboard Today. The load calculation shares the canonical CTL/ATL constants and daily-load
builder with the dashboard, while scoring and sleep-evidence selection call the environment-neutral
`shared/readiness.ts` evaluator.

The response returns the score, label, confidence, total/available driver count, available original weight before
missing-driver renormalization, aggregate baseline-evidence count, and four explicit driver groups:

- Load (40%): current Form, seven-day ramp, UTC day, and the oldest selected snapshot update time.
- Sleep (25%): the eligible latest main-sleep date, end time, duration, resulting score, and whether that score was recorded
  or derived from duration.
- HRV (20%): latest safe aggregate milliseconds, same-provider baseline median, matching-night count, and ratio.
- Overnight HR (15%): the combined ratio plus separate average and minimum sleep-HR latest values, baseline medians,
  matching-night counts, and ratios.

HRV and heart-rate states distinguish `not_recorded` from `insufficient_baseline`; a ratio requires at least three prior
same-provider values. The tool aggregates duplicate same-provider/date sessions with the same readiness grouping rules,
accepts average HRV before the normalized overnight-HRV fallback, excludes naps and evidence older than 48 hours for the
current score, and never returns provider, session/document identity, source fields, raw samples, score components, or
provider payloads. It is contextual and cannot diagnose illness, prescribe a workout, or establish a multi-day trend;
use `get_sleep_trend` for trend questions.

### Daily health and Training report

`get_daily_report` is the preferred one-call source for a good-morning request or current daily report. It requires both
`metrics:read` and `sleep:read`, accepts one explicit IANA timezone, and preserves the same local-day-context versus
UTC-readiness-boundary distinction as `get_today_readiness`.

The report reuses the live readiness loader, Form/ramp source selection, deterministic same-provider/date sleep grouping,
and shared readiness evaluator rather than chaining public tool calls or defining another score. One projected 30-day
sleep query supplies both the report and readiness. It reads at most 257 documents to enforce an at-most-256-session
bound and selects only provider grouping, sleep date, start/end/duration, in-bed duration, normalized timezone offset,
nap state, score value/qualifier, aggregate average/overnight HRV, and aggregate average/minimum sleep HR. Provider
identity is used only for internal grouping and never enters the response.

The latest completed main-sleep projection returns the safe session timing, duration, in-bed duration, score, and an
explicit four-field aggregate-vital allowlist: average and overnight HRV in milliseconds plus average and minimum sleep
heart rate in beats per minute. Each missing value is `null`; a grouped sleep returns in-bed duration only when every
fragment recorded it, preventing a partial sum from looking complete. Raw samples, SpO₂, respiration, provider identity,
source metadata, and score components are absent. The duration comparison uses up to 14 earlier same-provider nights
and requires at least three before returning an average or delta.

The nested readiness object is the exact strict `get_today_readiness` result, including safe driver values, baselines,
ratios, evidence states, and freshness. The Training summary reuses the frozen briefing's strict current-versus-usual
equivalent 28-day projection. Server instructions tell clients to lead with sleep and recorded HRV/heart-rate values,
summarize readiness in one sentence using at most two relevant available drivers, then summarize Training. The report
does not diagnose illness, prescribe a workout, or establish a multi-day trend; use `get_sleep_trend` when the question
asks about change over time, SpO₂, or respiration.

### Compact briefing

`get_daily_briefing` is a compact convenience read that requires both `metrics:read` and `sleep:read`; neither scope
alone registers it. The caller supplies an IANA timezone. The response records the resulting local-day bounds and
contains only the latest completed non-nap sleep session plus a duration comparison against up to seven earlier
same-provider nights. It also projects the safe `training_summary` headline: equivalent current and usual 28-day
workout counts, duration, easy/moderate/hard time totals, and the corresponding Running/Cycling/Swimming breakdown.
The usual period is an equivalent 28-day comparison normalized from the snapshot's preceding 84-day source window, so
its workout count may be fractional. Provider identity, raw vitals, stages, score components, sessions, locations,
activities, body measurements, and source fields are absent from this projection.

It also reads the current `training_readiness` snapshot through its exact strict payload schema, but returns only its
freshness, score, label, confidence, and aggregate evidence counts. Readiness itself remains UTC-day based. A snapshot
whose `asOfDayMs` is not the current UTC day is reported as `stale` with score and evidence fields withheld; missing or
invalid snapshots use explicit `not_ready` or `no_signal` statuses. The tool provides context only: it does not create a
workout plan, prescribe exercise, or provide medical advice. It uses the existing sleep-session query shape, so it
requires no new Firestore composite index.

## Bounds and operational controls

- Event and sleep date ranges are at most 366 days.
- Body-measurement ranges are at most 366 days and return only day/week/month buckets. They share the event query's
  2,000-document, 4 MiB stats, and 20,000 stat-entry limits, then apply a separate 128 KiB response limit.
- An event metric query selects only the requested canonical stats plus activity type, reads at most 25 events per
  Firestore page, and rejects matches above 2,000 events, more than 4 MiB of cumulative serialized selected stats, or
  more than 20,000 cumulative selected top-level stat entries.
- Sports Lib import begins only after those cumulative budgets pass and receives only the requested metric plus the
  activity-type stat needed for filtering.
- Multi-metric queries accept at most four selectors, share the same 2,000-event, 4 MiB, and 20,000-entry work budgets,
  import each eligible event once, and return at most 256 KiB.
- A sleep summary rejects matches above 1,000 sessions.
- Sleep-vital discovery uses the same at-most-1,000-session bounded read as a sleep summary and returns only fixed
  allowlisted type metadata and per-type session counts.
- One-call sleep trends use that same at-most-1,000-session bounded read, return only fixed coverage metadata and strict
  summary buckets, and do not perform a separate discovery read.
- Live readiness reads at most 257 projected sleep documents to enforce an at-most-256-session 30-day bound, reads
  exactly the three ready load snapshots in parallel, and returns at most 16 KiB. Its score uses only the latest
  eligible main sleep plus up to 14 same-provider baseline nights after deterministic same-date aggregation.
- A daily report reuses that same bounded sleep/readiness work, reads only the additional ready `training_summary`
  snapshot, compares duration with at most 14 earlier same-provider nights, and returns at most 16 KiB.
- Sleep pages are at most 100 sessions and use a per-connection encrypted cursor that does not expose the Firestore
  document ID used to resume pagination.
- A daily briefing reads at most 33 recent sleep documents from a fixed 14-day lookback, keeps at most 32 completed
  non-nap sessions, uses at most seven same-provider baseline nights, reads the ready `training_summary` and
  `training_readiness` snapshots in parallel, and returns at most 16 KiB.
- Explicit activity date ranges are at most 366 days; relative today/yesterday ranges require an IANA timezone. An
  omitted activity range starts newest-first across history. Activity-list calls scan at most 100 documents, return at
  most 100 matching entries, report scan counts/completion, and reject more than 512 KiB of cumulative selected data.
  Route-list calls likewise scan at most 100 documents, return at most 100 matching entries, report scan
  counts/completion, and reject more than 512 KiB of cumulative selected data.
- Nearby activity calls scan at most 100 summaries, return at most 25 matches and 256 KiB, and can traverse all history
  only through encrypted query-bound pages.
- Nearby route calls scan at most 50 summaries, load at most 12 persisted previews, process at most 1 MiB and 20,000
  decoded preview points, and return at most 10 matches and 256 KiB.
- Lap, jump, and swim-length arrays are limited to 10,000 raw entries and 512 KiB before projection; responses are at
  most 100 entries and 256 KiB per page.
- Per-activity metric calls accept at most 25 requested types, process at most 64 KiB of selected document data, and
  return at most 32 KiB.
- Activity overviews process at most 64 KiB of stats plus 10,000 detail entries/512 KiB of raw detail arrays, do not
  parse original source files, and return at most 64 KiB.
- Activity ranking reads at most 2,000 projected activities in pages of 25, rejects more than 512 KiB of projected
  activity data, returns at most 25 results, and has a 128 KiB response limit.
- Training metric discovery reads only the snapshot envelope for descriptors matching the optional search and returns
  at most 64 KiB; it does not read or project snapshot payloads.
- On-demand activity charts accept one to four metrics, default to 300 and allow at most 400 points per metric, and
  default to 500 and allow at most 1,000 breadcrumb points. One parse may read at most four files, 12 MiB cumulative
  raw/compressed bytes, 64 MiB cumulative decompressed bytes, and 250,000 selected samples, with a 20-second internal
  runtime and 256 KiB response limit. Larger valid streams are downsampled over the complete domain; hard point,
  source, sample, runtime, decompression, and response overruns fail the whole request.
- Route previews are limited to 20 segments, 5,000 decoded points, and 256 KiB. Route source reads are limited to 2 MiB,
  decompression to 8 MiB, and waypoint output to 500 entries and 256 KiB.
- Metric discovery scans the latest 500 event documents, excludes benchmark merges, and reports whether the scan was
  truncated.
- Each MCP connection is limited to 120 authorized MCP HTTP requests per minute through a distributed Firestore counter.
- On-demand source parsing is additionally limited to six requests per connection and twelve per user per minute using
  opaque documents in the existing TTL-managed `mcpOAuthRateLimits` collection.
- Place-name geocoding is additionally limited to 30 requests per MCP connection per minute; coordinate input bypasses
  Mapbox and this provider-specific counter. The geocoding counter transaction rechecks account-deletion state before
  writing, preventing an in-flight lookup from recreating MCP state after user cleanup.
- Public authorization starts are limited before client-metadata retrieval to 10 per client ID and 30 per requester
  address per minute.
- Public token revocations are limited before hashed-token lookup to 30 per client ID and 60 per requester address per
  minute. Rate-limit document IDs hash both raw keys. Each accepted endpoint request performs exactly two hash-document
  lookups and, only for a matching token, the bounded account-guard and single-connection reads in that same
  transaction.
- Private client assertions are limited to 16 KiB and ten minutes, use an RS256 key of at least 2048 bits from a
  bounded ten-key JWKS, and are single-use through opaque TTL replay markers. The server accepts either its advertised
  issuer or exact token endpoint as the RFC 7523 audience for MCP SDK and vendor interoperability.
- A rejected private client assertion emits only a fixed internal stage (`parameters`, `encoding`, `header`, `jwks`,
  `signature`, `claims`, or `replay`) and the generic OAuth error code. It never logs the assertion, any token or
  authorization code, client ID, request parameters, or user identity.
- Requests require valid IANA timezones where local date bucketing is relevant.
- Logs must not contain access or refresh tokens, authorization codes, client assertions, client payloads, event data,
  sleep data, or user IDs.

## Local verification and release

Use the Functions emulator and local Angular app for the OAuth/consent flow. At minimum run:

```bash
npm --prefix functions test -- src/mcp
npm --prefix functions run build
npm --prefix functions run mcp:contract:check:compiled
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
