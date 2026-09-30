# Calendar presentation

- Keep the day sheet, full day page, Dashboard day preview, and Calendar day preview aligned through
  `_calendar-day-presentation.scss`; reuse shared typography instead of introducing separate list styles.
- Preserve each surface's existing layout unless it is explicitly in scope. Day-sheet rows must remain compact,
  content-sized, and on the shared overlay surface, with wrapping at 320px and accessible Material actions.
- Selected-day previews and the sheet use shared body-medium titles, body-small metadata, and 20px sport icons;
  do not replace row icons with compact grid markers, add vertical accent rails beside them, or shrink preview text independently.
- Keep compact recovery metric typography shared between the sheet and previews (label-small, 19px values).
  Reset overlay tracking on the day-sheet content; do not let Material's body-large typography leak into nested content.
- Hide completed-activity totals and sections on ready days without recorded activities. Keep loading/error states
  and other day content visible; a linked planned workout alone is not a recorded activity.
