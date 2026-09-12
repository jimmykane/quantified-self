# Frontend Agent Instructions

Read `/Users/dimitrios/Projects/quantified-self/AGENTS.md` first.

Frontend-only rules:
- `../.agent/rules/rules.md`
- `../.agent/rules/material-design-strict.md`
- When adding a new indexable public page, add it to `sitemap.xml` in the same change. Also verify its `robots.txt`
  policy, SSR/prerender registration, route SEO metadata, public-route handling, internal links, and tests. Deliberately
  exclude non-indexable pages from the sitemap and set their `noindex` policy where applicable.
- Authenticated product workspace routes, except Settings, must apply the shared `qs-workspace-page` class to their route
  root. Do not add route-local outer width, margin, or padding rules. Settings intentionally retains its centered 760px
  form layout. See `docs/frontend-ui.md` for the shell contract.
- Always include the app's haptic feedback in new or changed interactive UI. Reuse `AppHapticsService` and
  `appHapticTap` (exported by `AppChartSharedModule`); never call vibration APIs directly. Audit the whole interaction,
  including mobile selectors, range/source changes, disclosure controls, dialogs, retries, and completed mutations.
- Use selection feedback for accepted user actions and success/error feedback only after the operation actually
  succeeds/fails. Do not vibrate for hydration, background refreshes, typing, disabled actions, or unchanged selections.
  Prefer Material semantic events for selects/toggles so touch and keyboard work. Give each action one feedback owner;
  do not duplicate the directive, handler, router-navigation, or shared ECharts haptics. Reuse the shared chart feedback
  options rather than adding chart listeners. Preserve unsupported-device, reduced-motion, pointer, and rate-limit guards.
- Test feedback with a mocked `AppHapticsService`, including silent initialization/no-op paths and async outcomes.
  Browser emulation can check wiring and layout but cannot prove physical vibration; report device verification honestly.
