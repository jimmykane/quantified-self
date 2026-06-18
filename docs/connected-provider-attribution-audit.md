# Connected Provider Attribution Audit

This checklist tracks the shared provider presentation rules for Garmin, Suunto, and COROS. It is the internal audit pass before any provider-specific screenshot packet.

## Shared rules

- Imported-data surfaces use provider **source attribution**.
- Connection, upload, sync-destination, and reconnect surfaces use provider **destination branding**.
- Shared icons come from `app-service-source-icon` or the provider SVG asset already registered in the app.
- Export/copy helpers accept explicit attribution input instead of inventing provider labels from local table structure.

## Garmin-specific stricter rule

- When one clear Garmin device model is available, source attribution should read `Garmin <device model>`.
- If the Garmin source is unknown or mixed, fallback is plain `Garmin`.
- Destination branding should read `Garmin Connect`.

## Surface matrix

| Surface | Mode | Providers | Expected text / asset | Export or share | Garmin review evidence |
| --- | --- | --- | --- | --- | --- |
| Event summary device/source banner | Source | Garmin, Suunto, COROS | `app-service-source-icon`; Garmin may render `Garmin <device model>` | No | Yes |
| Map activity popup source badge | Source | Garmin, Suunto, COROS | `app-service-source-icon` tooltip with `Synced from …` | No | Yes |
| Routes list `Synced from` column | Source | Garmin, Suunto, COROS | Source icon plus provider/source label | No | Yes |
| Route detail provenance chips | Source + destination | Garmin, Suunto, COROS | `Synced from …`, `Sent to …` with shared provider labels | No | Yes |
| Dashboard auto-sync prompts | Source | Garmin, COROS, Suunto | Prompt copy uses shared provider source labels | No | Yes |
| Services navigation and connection cards | Destination | Garmin, Suunto, COROS | `Garmin Connect`, `Suunto App`, `COROS` on connection surfaces | No | Yes |
| Activity upload to service | Destination | Suunto, COROS | Shared destination label in upload UI copy | No | Yes |
| Public Integrations provider strips | Source | Garmin, Suunto, COROS | Shared source label plus provider icon | No | Yes |
| Workout Data Comparison provider strip | Source | Garmin, Suunto, COROS | Shared source label plus provider icon | No | Yes |
| Clipboard markdown export | Source / series provenance | Any explicit provider context | Optional `Source:` and `Series sources:` note | Yes | Maybe |
| Clipboard Sheets export | Source / series provenance | Any explicit provider context | Optional table caption plus TSV metadata rows | Yes | Maybe |

## Remaining manual review

- Verify every Garmin data screenshot intended for Garmin review still shows nearby attribution after responsive layout changes.
- Confirm any future Garmin Connect consumer-facing asset swap uses approved Garmin Connect branding assets.
- Re-audit new provider surfaces when route delivery to Garmin or COROS expands beyond the current develop branch.
