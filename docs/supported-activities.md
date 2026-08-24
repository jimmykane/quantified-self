# Supported Activities and Metrics Catalog

The public **Supported Activities & Metrics** page at `/features/supported-activities` is the user-facing reference
for every canonical activity type recognized by the pinned `@sports-alliance/sports-lib` release. It explains the
distinction between recognition, the activity family used throughout the product, and the records that an imported
activity actually contains.

## Canonical catalog ownership

`shared/activity-type-group.metadata.ts` owns Quantified Self's presentation metadata for Sports Lib activity groups:
labels, aliases, and ambiguity rules. It derives group membership from the unique canonical Sports Lib activity-type
array and `getActivityGroupForActivityType`, then sorts each group by name. `getActivityTypeGroupCatalog()` joins that
membership to the presentation metadata.

This deliberately avoids treating Sports Lib's direct group-member convenience function as the catalog source: the
unique canonical type array is the complete partition, including the Unspecified fallback family. The page therefore
cannot silently omit a recognized type or show one in two families. The exhaustive helper test verifies the current
release's group count, type count, deduplication, and exact partition.

The Angular page is split into:

- `supported-activities-page.content.ts` for the catalog-derived public content, visual mappings, and SEO data;
- `supported-activities-page.component.*` for searchable, expanded family cards; and
- `supported-activities-page.paths.ts` for the shared route path.

It uses the existing `AppActivityTypeGroupIcons`, colors, and gradients. There is no second hand-maintained activity
list, no raster icon set, and no provider compatibility matrix.

## What “supported” means

Recognizing an activity type means Quantified Self can classify and present an imported activity using that canonical
type. It does not promise that every device, provider, import format, or recording setting supplies the same fields.
Distance, route, terrain, sensors, laps, lengths, jumps, charts, and sport-specific details are shown only when
compatible records arrive in the source data.

Event Details shows Laps when selected activities contain lap data, Swim Lengths when a swimming source includes
per-length pool data, and Jumps when selected activities contain jump events. Charts and overlays likewise need
compatible source time series. These are source-record surfaces, not additional promises made by catalog membership.

The page, Help section, integration links, and discovery links must retain that source-dependent wording. Do not turn
the catalog into a claim that a provider supports every type or metric.

## Families and Event Details profiles

Families organize activities for product presentation, filters, labels, icons, colors, and related fallback behavior.
They are not a universal chart-profile declaration. Event Details resolves chart recommendations through the exact
canonical activity type first; the current multi-activity fallback rules are maintained in
[`event-chart-visibility.md`](event-chart-visibility.md).

Two intentional examples must remain clear in user-facing content and regression tests:

- **Boating** belongs to the Motorized family while retaining Sailing chart recommendations for an individual
  Boating activity.
- **Wheel Chair** belongs to Adaptive Mobility while retaining Cycling chart recommendations when compatible source
  metrics exist. This does not by itself classify it as Cycling for Training.

Hand Cycle and Velomobile are Cycling types. They use the existing Cycling chart recommendations and may enter
Cycling Training analysis only when the current recorded-evidence and eligibility rules are satisfied. Do not flatten
these distinctions merely to make a family appear uniform.

## Diving

Diving, Scuba Diving, Free Diving, Snorkeling, and Mermaiding have source-native Event Details presentation. Depth,
decompression, timing/rate, tissue-load, SAC/RMV, gas, tank, and Dive Profile information appears only when the
original activity source supplies compatible records. The product never invents, names, associates, or calculates
missing gas or tank data.

Diving-only Events omit terrain altitude, ascent, descent, and grade summaries because their vertical movement is
represented as depth. Mixed Events retain terrain summaries only from non-Diving activities. The detailed chart and
profile exclusions remain owned by [`event-chart-visibility.md`](event-chart-visibility.md).

## Maintenance checklist

When changing the pinned Sports Lib activity types or activity-group behavior:

1. Update the shared dependency in both the application and Functions as required by the release lifecycle.
2. Inspect the canonical catalog with `getActivityTypeGroupCatalog()` and update its exhaustive test expectations.
3. Ensure every group has existing icon, color, and gradient mappings before the public page renders it.
4. Update the public page, Help content, this document, sitemap/robots/prerender route configuration, and SEO checks
   if the public route or its contract changes.
5. If a chart recommendation changes, update the Event Details resolver tests, Help content, and
   `event-chart-visibility.md` together; preserve exact-type-first behavior unless the product contract deliberately
   changes.
6. Run the focused catalog, page, routing, Help, hosting, and SEO tests, then `npm run lint` and
   `npm run build-production`.
