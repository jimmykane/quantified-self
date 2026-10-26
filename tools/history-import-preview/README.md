# History import UI alternatives

Local Angular design fixture; it is not registered in the app, deployed or connected to user/provider data.
Uses the shipped shell header, provider icons, dashboard preview, fonts, theme and existing import-details component.
Import states and dashboard values are synthetic. No authentication, Firestore, Stripe, analytics or provider calls
are initialized. Haptics are mocked. No production feature or data contract is changed.

From this directory with Node 22 and the repository dependencies installed:

```sh
../../node_modules/.bin/ng serve preview --host 127.0.0.1 --port 61933
```

- `/?design=banner`: compact status strip below the header, details on demand.
- `/?design=card`: dashboard card with resource stages.
- `/?design=drawer`: header entry and open import drawer; mobile uses a bottom sheet layout.
- `/?design=header`: collapsed header indicator for three imports; tap to open dashboard-style provider cards.
  Suunto imports, Garmin waits for delivery and COROS retries automatically. Each card opens its own matching details.
- Add `&theme=light` to check the light theme.

Only local disclosure controls work. The details dialog uses the current production component with synthetic data;
provider/account mutations are unavailable. Counts deliberately retain the current **items or requests** semantics.
Garmin says **Waiting for Garmin**, because submitted requests cannot prove data delivery. No percentage or ETA is invented.
These are alternative placements for review, not a proposal to show all three at once.
