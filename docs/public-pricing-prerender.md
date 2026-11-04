# Public pricing and release-note prerendering

`/pricing` and `/releases` are static public routes. Crawlers and social scrapers
receive rendered content, route metadata, canonical URLs, JSON-LD and the public
footer without needing JavaScript or browser App Check. Both routes are listed
in the sitemap and excluded from Hosting and service-worker CSR fallbacks.
Production does not attach a `noindex` header to either page; beta remains
non-indexable under its existing site-wide policy.

## Build contract

`npm run build`, `npm run build-beta` and `npm run build-production` first run
`npm run generate:public-snapshots`. Both snapshots must load and validate before
Angular builds. The individual generators remain available as
`npm run generate:public-pricing-snapshot` and
`npm run generate:public-releases-snapshot`.

The shared read-only Firestore REST client uses `google-auth-library` and
Application Default Credentials (ADC). It obtains fresh authorization headers
for each request, permits only the fixed project's catalog paths and query
endpoint, rejects redirects, bounds each HTTP request to 30 seconds, and reports
safe errors without credential-provider details. It never falls back to an
anonymous request or disables App Check.

Production Firestore App Check enforcement rejects unverified anonymous REST
requests even when Security Rules permit a public read. The browser obtains
App Check tokens through its existing Firebase initialization. Trusted build
reads instead use OAuth and IAM authorization. See
[Firestore REST authentication](https://firebase.google.com/docs/firestore/use-rest-api#authentication_and_authorization).

### Snapshot contents

- **Pricing:** active `products` and their active `prices` subcollections,
  allowlisted public display fields and role/trial metadata. An empty catalog
  or one without renderable Basic and Pro recurring prices fails the build.
  The ignored output is `tmp/public-pricing-snapshot.json`.
- **Releases:** a projected `changelogs` query with `published == true`, ordered
  by date and document name descending. Pagination preserves the original
  timestamp precision and uses the document name to break ties. Drafts, malformed
  responses, invalid public fields and repeated pages fail generation. Only
  ID, title, Markdown description, date, publication flag, type, optional image
  and version enter `tmp/public-releases-snapshot.json`. A successfully loaded
  collection with no published posts is a valid empty feed.

Snapshot generation performs no Firestore writes. Tokens, credential files,
raw responses and unpublished release notes must never be committed or copied
into browser assets. Only the validated public content enters rendered HTML
and Angular TransferState. The snapshots themselves remain ignored build inputs.

## GitHub Actions and local authentication

The existing protected Hosting jobs already authenticate through
`google-github-actions/auth@v3`, using the shared GitHub Workload Identity
Provider and these service accounts:

- production: `qs-github-production-hosting@quantified-self-io.iam.gserviceaccount.com`
- beta: `qs-github-beta-hosting@quantified-self-io.iam.gserviceaccount.com`

Their exported ADC credential file is consumed by the snapshot client. No new
service-account key or GitHub secret is required. Keep these reads in trusted,
protected builds; PR and fork tests use synthetic fixtures without cloud access.
Generated `gha-creds-*.json` files are ignored and must not enter build artifacts.

For local release builds, configure ADC outside the checkout with
`gcloud auth application-default login`, then run `npm run build-production`.
A normal `gcloud auth login` session alone is not the ADC setup. Do not copy or
symlink a credential profile into a checkout or set a global anonymous fallback.

### Pending IAM prerequisite: separate approval required

The Hosting identities' project bindings currently grant Hosting administration
and service-usage viewing, without Firestore data reads. The code change does
not apply IAM grants. After explicit approval of these identities and this scope,
an operator can add the following database-conditioned read-only grants:

```bash
gcloud projects add-iam-policy-binding quantified-self-io \
  --member='serviceAccount:qs-github-production-hosting@quantified-self-io.iam.gserviceaccount.com' \
  --role='roles/datastore.viewer' \
  --condition='expression=resource.name=="projects/quantified-self-io/databases/(default)",title=public_prerender_read'

gcloud projects add-iam-policy-binding quantified-self-io \
  --member='serviceAccount:qs-github-beta-hosting@quantified-self-io.iam.gserviceaccount.com' \
  --role='roles/datastore.viewer' \
  --condition='expression=resource.name=="projects/quantified-self-io/databases/(default)",title=public_prerender_read'
```

This grants read access across the default database, including private documents;
IAM does not enforce the generator's published-only filter or field allowlist.
Those filters limit this build's output, not the credential's authority. The
condition excludes other databases and the role grants no data writes. Review
that trust boundary before approval. See
[Firestore IAM](https://cloud.google.com/firestore/native/docs/security/iam) and
[per-database conditions](https://cloud.google.com/firestore/native/docs/manage-databases#configure_per-database_access_permissions).
Allow IAM propagation before verifying a protected build. An HTTP 403 after
ADC is configured indicates an authorization prerequisite, not permission to
weaken App Check or Security Rules.

## Server rendering and browser behavior

The pricing server provider transforms the snapshot with the same catalog
helper used by the browser. Its visible plans and Offer JSON-LD use the same
catalog. The browser consumes the transferred catalog once and shares it within
that app session. Client navigation without transferred data reads the live
catalog. Direct loads of static pricing use the deployment's catalog snapshot.

The release-note server provider reads its snapshot only when the release route
requests it. It does not put release content into unrelated pages or mark posts
as read. The browser seeds both the resolver and feed from TransferState, then
continues the existing published Firestore subscription. Live updates can appear
between deployments, and existing admin draft reads and unread behavior remain
separate from the public snapshot.

Public price or release-note changes require a normal rebuild and an explicitly
authorized Hosting deployment to update static HTML. No server runtime is added.
`QS_REQUIRE_PUBLIC_PRICING_SNAPSHOT=true` and
`QS_REQUIRE_PUBLIC_RELEASES_SNAPSHOT=true` prevent release builds from silently
prerendering missing or invalid files. Local development without these release
flags may use the existing empty server placeholders.

## Verification

`npm run test:public-snapshots` covers ADC headers, read-only request boundaries,
redaction, protected WIF workflow wiring, build prerequisites, pagination and
negative leakage fixtures. Frontend tests cover snapshot validation, resolver
hydration, live refresh, required server files, routing, SEO and Hosting policy.

`npm run build-production` generates real snapshots and checks service-worker
assets plus public startup dependencies. The production verifier checks actual
pricing cards and hydration data, every published release title and rendered
Markdown body, exact release metadata, canonical URLs, JSON-LD and the public
footer. Builds and verification do not deploy.
