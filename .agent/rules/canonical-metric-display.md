---
trigger: always_on
description: Render canonical metric values and units through Sports Lib and the user's unit settings.
---

# Canonical Metric Display

For every user-facing rendering of a canonical metric—cards, tables, chart axes, tooltips, legends, accessible text,
exports, and generated summaries—use its Sports Lib data class for both the display value and display unit.

- Never hand-format canonical numeric values, read a unit directly from stored or catalog data for display, or hard-code
  a unit abbreviation.
- Apply the signed-in user's `settings.unitSettings` through the shared `shared/unit-aware-display.ts` helpers, which use
  Sports Lib's `DynamicDataLoader` conversion, before calling `getDisplayValue()` and `getDisplayUnit()`. Both must come
  from the same converted Sports Lib instance.
- For canonical Health and Sleep metrics, first use their explicit mapping in
  `shared/sports-lib-health-data.ts`.
- Only explicitly native-only or non-comparable provider values may use a provider-labelled fallback, and they must
  never be presented as canonical or user-unit-converted.
- Add display tests for the default unit settings and a relevant non-default user unit preference whenever adding or
  changing a metric surface.
