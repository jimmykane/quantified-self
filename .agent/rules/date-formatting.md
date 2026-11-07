---
trigger: model_decision
description: Use for date/time display changes, localization, and formatting consistency in Angular templates/services.
---

Use this rule when working with dates and localization.

## Apply This Rule
- New date/time displays in components
- Date format refactors
- Localization-related date behavior

## Do Not Apply This Rule
- Tasks without date/time formatting

## Standards
- Use Angular `DatePipe`; avoid direct `toLocaleDateString()` or `toLocaleTimeString()` in app code.
- Do not hardcode locale strings in components.
- Use project locale configuration from app setup.
- Use `getAppLocale()` for user-facing `Intl` formatters and helper defaults. It resolves the validated account-backed
  regional-formatting preference first, the browser's ordered supported languages for **Automatic**, and deterministic
  `en-GB` during server rendering or when no supported locale is available.
- Keep Angular `LOCALE_ID`, Material/Day.js, charts, percentages, and shared helpers on that same effective app locale.
- A regional-formatting choice changes display conventions only. It must not change language, timezone, measurement
  units, start of week, stored values, calculations, API contracts, or provider semantics.
- Preserve machine-readable and interoperable dates as ISO calendar dates (`YYYY-MM-DD`) in CSV data, filenames, API
  values, storage keys, and provider payloads unless the owning contract explicitly requires another representation.
- Prefer Angular predefined formats (`shortDate`, `mediumDate`, `longDate`) unless UI requires a specific tokenized format.
- For editable dates, reuse Material's datepicker with the shared `DayjsDateAdapter` and `MAT_DAYJS_DATE_FORMATS`.
  Native `input[type="date"]` uses browser/OS formatting and bypasses the saved regional preference; do not use it for
  app-formatted date fields. In calendar/planning controls, retain the owner's saved `startOfTheWeek` independently of locale.
  Keep date-only values as calendar labels when converting picker values; do not round-trip them through UTC instants.

## Examples
- `{{ startDate | date:'mediumDate' }}`
- `{{ startDate | date:'mediumDate' }} - {{ endDate | date:'mediumDate' }}`

## Validation
- Verify user-facing date and number displays in representative explicit and Automatic locales when possible.
- Verify machine-readable outputs retain their contract format independently of the display locale.
- For date editors, test a saved format different from the browser (at least day-first and month-first), typed and
  picked dates, invalid/cleared input, and unchanged stored calendar days. Do not treat a default-locale screenshot as
  proof that user preferences are respected.
