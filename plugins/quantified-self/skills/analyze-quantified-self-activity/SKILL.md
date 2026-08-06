---
name: analyze-quantified-self-activity
description: Analyze one or more authorized Quantified Self activities through its read-only MCP tools. Use for individual workouts, activity summaries, canonical metrics, laps, MTB jumps, swim lengths, pace or power charts, breadcrumb traces, or finding activities near a place; use the training skill for aggregate trends across many activities.
---

# Analyze Activity Performance

Resolve activities through opaque public references and request only the detail needed for the question.

## Workflow

1. Find the target activity and retain its opaque activity reference. Discover canonical activity types when the user
   names a sport, then apply the server-side activity-type filter. For “latest” or “last,” omit date selectors and
   request one matching newest-first result. For “today” or “yesterday,” use the relative-period input with the user's
   IANA timezone; use explicit paired bounds for another calendar date. Repeat the original filters with a returned
   cursor until a match is found or the scan reports completion. Never infer that an individual workout is unavailable
   from aggregate metrics or a Training snapshot. When a family term such as run could include trail, treadmill,
   indoor, or virtual variants, use the catalog's group/indoor hints and clarify only when that distinction can change
   the answer.
2. After resolving the opaque reference, use the coordinate-free activity overview to check the metrics, lap, jump,
   swim-length, and chart capabilities actually available. Request granular data only when relevant to the activity
   type and question.
3. Before charting, discover the chart metrics supported for the activity type. Request only the needed series and
   axis, and use bounded points appropriate for the requested presentation.
4. Treat returned chart points as whole-activity downsampling rather than full-resolution raw samples. Preserve axes,
   canonical units, source and returned counts, missing counts, and processing limitations.
5. Continue pagination only when the requested analysis needs the remaining detail.
6. For highest, lowest, best, or worst requests tied to one persisted numeric metric, use the bounded ranking
   capability instead of downloading activity pages and sorting them client-side. Preserve its metric unit, date range,
   activity filter, scan coverage, and deterministic order.
7. For an MTB jump superlative, discover the Mountain Biking activity-group value and pass that group to the bounded
   ranking capability so the server, not the model, expands every canonical subtype. Follow the live server instructions
   to choose the persisted maximum metric matching the user's wording, and clarify genuinely ambiguous wording such as
   “best.” Omit start and end only when the user asks for all available history, and treat the ranked maximum as
   authoritative. Read individual jump records only when the user asks for subrecord details; preserve pagination
   completeness and say when the inspected records are incomplete. Never rank jump quality by jump count or by sorting
   a newest-first activity sample. If an all-history scan exceeds its processing bound, request or choose an explicit
   period rather than presenting a partial result as an all-time record.

## Permissions and Privacy

- `activity-details:read` gates activity summaries, subrecords, and non-location charts.
- Selected per-activity metrics also require `metrics:read`.
- `activity-location:read` separately gates start and end positions, nearby-activity searches, jump coordinates, and
  breadcrumb traces. Reject an explicit location request rather than silently downgrading it.
- Request location only when it materially helps. Do not expose internal IDs, source keys, original files, absolute
  sample timestamps, provider or device provenance, or parser details.
- Treat a missing permission, unavailable original source, processing budget, incompatible metric, and missing stream
  as different outcomes.

## Response

- Lead with the activity finding, then show the supporting summary, subrecord, or chart evidence.
- Label chart axes and values with returned units and state material redaction, source, or sampling limitations.
