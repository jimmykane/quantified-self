# Event Chart Sport Defaults and Visibility

This document is the maintenance contract for sport-aware visibility in the ordinary Event Details chart stack. It
does not apply to Dashboard tiles, Training charts, or MCP output.

## Selection pipeline

The chart applies these constraints in order:

1. `buildEventChartPanels` creates the finite, chartable panels currently discoverable for the selected activities.
   The existing **Include all recorded metrics** setting controls whether discovery is limited to Default chart
   metrics or expanded to every supported recorded metric.
2. `resolveEventChartSportProfile` canonicalizes the selected activity types through Sports Lib and produces a stable
   signature plus an ordered logical metric-family profile.
3. A custom visibility preference for the event and signature wins. Invalid or unavailable stored keys are filtered
   from the current panels without changing custom provenance; the stored selection can become visible again if panel
   discovery later makes it available. An explicitly empty v2 custom preference remains empty.
4. Without a custom preference, `resolveEventChartRecommendations` intersects the profile with the user's Default
   chart metrics, finite available panels, unit-derived selection keys, and explicit specialized-surface exclusions.
5. The first up to three eligible recommendations become visible. The resolver does not pad a sparse profile with
   unrelated panels and does not persist this automatic result as a custom choice.

The profile resolver is a pure helper in
`src/app/helpers/event-chart-sport-profile.helper.ts`. Its registry deliberately covers every canonical activity type
exposed by the pinned Sports Lib release. The exhaustive test must fail when a dependency update adds an unclassified
canonical type. Activity counts, IDs, providers, and names do not affect the signature: it contains only sorted,
unique canonical activity types. A single type uses its exact profile. Multiple types that already share one profile
keep that deliberate exact or alias profile regardless of their Sports Lib groups. Only when the registered profiles
differ does the resolver consult Sports Lib groups: types in the same mapped group use the registry's deliberate
presentation profile for that group, while types in different groups use Multisport. Sports Lib's Unspecified group is
not treated as a coherent family for differing profiles because it is the fallback for unrelated canonical types that
have no group assignment.

Metric recommendations operate on logical families. Unit variants such as pace per mile, speed in knots, and depth in
feet resolve through existing Sports Lib unit groups. Power, Air Power, Right Power, and Left Power share one profile
slot while remaining independently discoverable panels. Grade-adjusted pace and speed are not promoted by the primary
Pace or Speed recommendation. For activities in Sports Lib's Swimming group, the global Pace preference also enables
the activity-appropriate Swim Pace panel in synchronous and worker-backed chart builds.

## Automatic and custom provenance

Automatic visibility is recalculated when the event, selected activity-type signature, available panels, units,
global Default chart metrics, or specialized exclusions change. It can therefore adopt later registry improvements.

The following actions create a custom preference:

- showing or hiding one item in **Visible charts**;
- selecting **Show all charts**, including when the automatic stack already contains every available panel.

**Reset to <sport> defaults** removes the custom preference for only the current event/signature and immediately
reapplies the current automatic result. Mixed or Multisport selections use **Reset to recommended defaults**. Reset
does not change Default chart metrics, Include all recorded metrics, overlays, x-axis, zoom, cursor behavior, fill,
laps, or swim-length settings.

## Local persistence contract

Visibility remains device-local browser state under the `chart.settings.service.` namespace. No activity document or
cloud data is changed.

The former unversioned `selectedDataTypes<eventID>` value is intentionally ignored. The versioned workflow does not
read, copy, rewrite, or delete it.

The v2 key is `selectedDataTypesV2<eventID>` and stores JSON with this shape:

```json
{
  "version": 2,
  "byActivityTypeSignature": {
    "types-v1:Running": {
      "mode": "custom",
      "selectionKeys": ["Heart Rate", "Pace"]
    }
  }
}
```

A `custom` entry may contain an empty list. Automatic visibility is represented by the absence of an entry for the
event/signature. Reset removes that signature entry and removes the v2 state when its signature map becomes empty.
Malformed v2 JSON is ignored safely and falls back to automatic visibility.

Stored values use unit-independent selection keys where Sports Lib exposes a unit group. On restore, a key selects the
currently rendered unit variant. Custom values for one signature never leak into another signature of the same event.

## Availability exceptions and specialized surfaces

Merged and benchmark events force panel discovery to include all recorded chartable metrics. Their automatic stack
still obeys Default chart metrics and the sport profile; the exception only ensures every chart can be selected or
used as an overlay. The **Include all recorded metrics** toggle is shown checked and disabled with explanatory copy,
and the user's global setting is not mutated.

When the pinned Dive Profile is present, Depth, Temperature, and Heart Rate are automatic exclusions for the ordinary
stack. The ordinary panels remain in **Visible charts** when discovery permits them, so a manual custom choice can
still display them. Other specialized surfaces do not exclude metrics unless they render the same time-series and an
explicit rule and test are added here.

## UX and accessibility

**Visible charts** explains that recommendations combine the selected sport, recorded metrics, and Default chart
metrics, then lists **Recommended for <sport>** in profile order followed by **Other available**. Checked state always
reflects the current visible stack. Visibility changes and reset results update a polite live region. Existing buttons,
menu focus behavior, touch targets, scroll bounds, overlays, zoom, laps, swim lengths, and source-series rendering
remain owned by their existing components.

When changing this contract, update the pure resolver tests, storage persistence tests, chart and action
component tests, app Help content, and this document together. Run the focused Vitest suites and an Angular production
build before committing.
