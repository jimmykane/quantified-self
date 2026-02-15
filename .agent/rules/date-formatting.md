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
- Prefer Angular predefined formats (`shortDate`, `mediumDate`, `longDate`) unless UI requires a specific tokenized format.

## Examples
- `{{ startDate | date:'mediumDate' }}`
- `{{ startDate | date:'mediumDate' }} - {{ endDate | date:'mediumDate' }}`

## Validation
- Verify date displays in at least one non-default locale scenario when possible.
