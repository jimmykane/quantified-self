---
trigger: model_decision
---

# Date Formatting Standards

Use this rule when working with dates and localization in the Angular application.

## Core Principles

1.  **Always Use Angular DatePipe**:
    *   **NEVER** use JavaScript's `toLocaleDateString()` or `toLocaleTimeString()` with hardcoded locales.
    *   **ALWAYS** use Angular's `DatePipe` in templates: `{{ date | date:'format' }}`
    *   For programmatic formatting, inject `DatePipe` and use it with the application's locale.

2.  **Locale Configuration**:
    *   The application uses dynamic `LOCALE_ID` from `navigator.language` with Greek (`el-GR`) as fallback.
    *   **DO NOT** hardcode locale strings in components.
    *   The locale is configured in `app.config.ts`:
      ```typescript
      { provide: LOCALE_ID, useFactory: () => navigator.language || 'el-GR' }
      ```

3.  **Preferred Date Formats**:
    *   Use Angular's predefined formats for consistency:
        *   `'shortDate'` - e.g., "8/12/25" (locale-dependent)
        *   `'mediumDate'` - e.g., "Dec 8, 2025" (locale-dependent)
        *   `'longDate'` - e.g., "December 8, 2025" (locale-dependent)
        *   `'EEEE, MMM d'` - e.g., "Sunday, Dec 8" for schedules
    *   For timeline markers, use individual components: `'d'`, `'MMM'`, `'yyyy'`

4.  **Adding New Date Display**:
    *   When adding date display to a component, always use `DatePipe`:
      ```html
      {{ race.startDate | date:'mediumDate' }}
      ```
    *   For date ranges:
      ```html
      {{ startDate | date:'mediumDate' }} - {{ endDate | date:'mediumDate' }}
      ```

## Checklist for Date-Related Changes
- [ ] Am I using Angular's DatePipe (not native JS methods)?
- [ ] Am I avoiding hardcoded locale strings?
- [ ] Does the date format match existing patterns in the app?
