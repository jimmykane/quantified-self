---
name: explore-quantified-self-routes
description: Explore the user's authorized Quantified Self saved routes through its read-only MCP tools. Use for route summaries, activity types, route geometry, bounds, segments, waypoints, or finding saved routes near a place or coordinate; do not use saved-route access to answer nearby activity-history questions.
---

# Explore Saved Routes

Use saved-route summaries first and request coordinate-bearing route data only when the question requires it.

## Workflow

1. List bounded route summaries and retain the opaque route reference for follow-up requests. When the user names a
   sport, discover its canonical activity type first and apply the server-side activity-type filter. Use the
   case-insensitive route-name search for a named route or partial name.
2. Preserve the original activity-type and name filters with every returned cursor. Continue until the requested match
   is found or the scan reports completion; distinguish a complete no-match from older route history that remains.
3. Request geometry for mapping or segment analysis and waypoints only when those details are relevant.
4. For nearby searches, prefer direct coordinates when the user provides them. Explain that place-name searches send
   the location text to Mapbox, while direct-coordinate searches do not.
5. Preserve returned units, route and waypoint counts, bounds, geometry format, pagination, and update timestamps.

## Permissions and Privacy

- `routes:read` provides non-location route summaries.
- `route-location:read` separately gates bounds, preview geometry, segment positions, nearby-route search, and waypoint
  coordinates, altitude, and distance. Reject an explicit location request rather than silently downgrading it.
- Activity-location permission does not grant route-location access, and route-location permission does not expose
  activity history.
- Do not expose internal IDs, source files, storage paths, provider provenance, or full-resolution route recordings.
- Treat a missing permission, absent geometry, empty search page, scan limit, and missing waypoints as different
  outcomes.

## Response

- Lead with the matching route or route set, then show distance, activity type, geometry, or waypoint evidence.
- State whether location was redacted and note any pagination or scan limitation next to the result.
