# Frontend UI Composition

## Route headers

Authenticated product routes use the shared `app-page-header` primitive from
`src/app/components/shared/page-header/`. It owns the common route-heading hierarchy, Material theme typography, and
responsive action placement. Import the standalone component directly from a standalone route, or use its export from
`SharedModule` in an NgModule-owned route.

Use the `route` variant for a primary workspace heading and the `compact` variant for embedded workspace context such
as Dashboard Today. Both variants use the same visible Material `headline-small` title role and a 40 px title row;
`headingLevel` controls document semantics rather than visual size. This keeps Dashboard Today, Calendar, Training,
Routes, and signed-in Compare files aligned without promoting an embedded section to an `h1`. The component
provides:

- `title`, `titleId`, and `headingLevel` for the page or section heading.
- `eyebrow` and `subtitle` for concise context and data currency.
- `status` for a consistent pending or warning title state.
- `leadingIcon` for a static, theme-colored Material icon in the shared 26 px leading slot.
- `pageHeaderLeading` for an existing icon action. Set `leadingAction` to preserve its Material touch target while
  keeping the title visually compact. Do not combine `leadingIcon` and `pageHeaderLeading` on the same header.
- `pageHeaderContext` for projected, domain-specific status content that replaces the eyebrow without adding a banner.
- `pageHeaderTitleActions` for a compact workspace-wide control that must stay beside the title at every breakpoint,
  such as Health Sources. Keep this slot small; normal route actions belong in `pageHeaderActions`.
- `pageHeaderActions` for existing Material controls. Route actions move to a dedicated full-width row below 800 px;
  compact headers retain their inline action layout.

The Dashboard, Calendar, Training, Routes, signed-in Compare files, and Settings workspaces use this component. A
page should not add route-local heading font sizes, action-row breakpoints, or a second title treatment. Keep page CSS
limited to the surrounding layout and domain-specific action groups.

Guest and public marketing views may retain a distinct hero composition. Their heading styles must remain local to that
public surface and must not become a new authenticated workspace-header pattern.

## Workspace Shells

Authenticated product workspaces, except Settings, use the shared `qs-workspace-page` shell from `src/styles.scss`. It
owns the 1440 px maximum page width, border-box sizing, and common responsive inline gutters. Apply it on the route root
alongside the route-specific class; do not add another outer width, margin, or padding rule in the component stylesheet.
Settings intentionally retains its centered 760 px form column, including its aligned fixed save action, rather than
stretching a form workflow across the workspace width.

## Sidebar navigation

Training remains a direct link to `/training`. Plans is an indented subitem immediately below it in a labelled Training
group, without an expansion control. Only the Plans entry uses the Training Planning navigation UID allowlist;
other signed-in users retain the direct Training link. This presentation hierarchy does not change `/plans`, Calendar
entry points, or owner-scoped planning access. Each link keeps its own active state and existing close/haptic action.

## Material and accessibility

Use Angular Material controls for header actions: `mat-icon-button` for icon-only navigation, `mat-button` for secondary
route actions, `mat-stroked-button` for bounded retry or configuration actions, and `mat-button-toggle-group` for view
modes. The primitive uses Material system color and typography tokens; consumers should not override its internal
elements.

Give each primary route title a stable `titleId` and reference it from the route `main` or workspace region with
`aria-labelledby`. Keep a title status concise and expose failures with the supplied warning status or an equivalent
projected `role="alert"` state.

## Account profile recovery

Firebase Auth identity and account-profile availability are separate states. Authenticated profile reads wait for
server snapshots; permission or App Check failures refresh both credentials with the existing bounded retry/backoff.
The recovery panel on `/login` explains that the user is still signed in. Its Retry action restarts the profile stream
and refreshes credentials without signing out, clearing persistence, or writing account data. Actual Auth sign-out or
an account switch cancels the old profile load and ends its recovery attempt.

The full Firestore SDK can return an incorrect persisted `NoDocument` result even through `getDocFromServer()`.
Before publishing a profile with missing required agreements or onboarding history (including a wholly missing profile),
`UserProfileVerificationService` checks the four profile documents through a lazily loaded Firestore Lite client.
The completeness check covers the onboarding guard's required policies plus completed onboarding, subscription
history, or existing paid/admin/grace-period access. This also protects free accounts when only the root document
appears missing and the legal document still exists. Server-confirmed unfinished setup continues to onboarding.
That client uses the same Firebase app's Auth and App Check providers, but does not use the watch/persistence cache.
Both readers share the same profile merge function. Failures remain recovery states; only verified missing data may
produce a new onboarding profile. Generation checks prevent an older asynchronous claim merge from reopening the
profile gate or continuing token retries during verification or a profile retry.

Complete profile snapshots add no Firestore reads. Incomplete snapshots require at most four additional document
reads per verification attempt; concurrent checks for the same snapshot and Auth session share one bounded request,
and identical listener snapshots do not repeat verification. Changed snapshots, a complete listener result, or a
restarted profile load invalidate the old shared result. Transient failures use the existing bounded retry budget.
The fallback does not clear or repair the broader SDK cache. An already completed account that recovers while on `/onboarding` leaves that route
without rewriting its completion flag or repeating completion analytics. The recovery behaviour applies to local,
beta, and production builds; only the App Check debug provider is development-specific.

## Surface elevation

### Shared compact rows

`CompactRowComponent` (`app-compact-row`) in `src/app/components/shared/compact-row/` is the flat content-row
primitive shared by Home, public feature pages, benchmark previews, and Health. It replaces the feature-specific
`CompactFeatureRowComponent` name; existing callers use the same component rather than a compatibility wrapper.

The default `layout="columns"` and `density="comfortable"` preserve the public feature presentation: optional icon,
heading, content, and action. `layout="stacked"` keeps an optional action beside the heading and gives content the
full row width at every breakpoint. `density="compact"` uses smaller icon/header spacing and Material text roles;
Health uses this combination for Highlights and source-separated charts. The primitive adds no card background,
rounded container, shadow, or nested content padding. `showDivider` controls the bottom divider.

For stacked chart rows, `[fillHeight]="true"` opts into stretching the row body within its allocated height; it is
ignored for column layouts and defaults to false. The Health metric explorer uses this on desktop to fill the space
beside the metric list, with a minimum plot height for multi-row grids. Mobile, Highlights, and public previews
retain their existing chart heights. The existing ECharts host observes the resized plot; no manual resize loop or
extra padding is needed.

`title`, optional `titleId`, and `headingLevel` (2, 3, or 4) own heading semantics; `summary`, `icon`, and `iconTone`
provide optional context. Default projected content can contain existing charts, tables, or metric displays.
`compactRowAction` projects a Material control into the action slot. The row is presentational: consumers retain
their existing Sports Lib formatting, data loading, accessible chart descriptions, and single haptic action owner.

Health's explorer, Sleep chart, and loading/empty states are not wrapped in additional card surfaces.

### Bounded surfaces

Use `.qs-glass-card-panel` for shared content surfaces that are not already represented by an ordinary Material card.
Both that primitive and default Material cards are intentionally flat through `--qs-card-shadow: none`; their border is
the primary separation from the workspace background. Floating menus, dialogs, datepickers, configuration submenus,
and bottom sheets use `--qs-overlay-shadow` so their temporary layer remains visually distinct. Do not reuse the overlay
shadow for in-flow cards or add route-local card shadows.
