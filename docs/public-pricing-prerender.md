# Public pricing prerendering

`/pricing` is a static public route so search engines and social scrapers receive
the same rendered plans and structured data as browser visitors.

## Build contract

`npm run build`, `npm run build-beta`, and `npm run build-production` first run
`npm run generate:public-pricing-snapshot`. The generator performs a read-only
request against the public Firestore `products` catalog and each product's
public `prices` subcollection. It needs no service account or Firebase Admin
credentials because the public site already reads this catalog while signed out.

The generator permits only the fields required for public plan rendering,
rejects an empty catalog or one without a paid Basic and Pro recurring price,
and writes the ignored `tmp/public-pricing-snapshot.json` file. A failed or
invalid snapshot fails the build; it must never publish a blank paid catalog.

During the static render, the server-side public catalog provider reads that snapshot, applies
the same product-to-plan transformation used by the browser payment service,
and puts the result in Angular TransferState. The browser consumes the value
once during hydration. A new browser session uses the live public Firestore
read path. The pricing JSON-LD is generated from that same catalog.

Price changes therefore require the normal site build and Hosting deployment to
appear in static HTML. They do not require a new credential, a server runtime,
or a database write during the build.
