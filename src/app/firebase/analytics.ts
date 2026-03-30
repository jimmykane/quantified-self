import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { Analytics as FirebaseAnalytics } from 'firebase/analytics';
import { FirebaseApp } from './app';

export { getAnalytics, initializeAnalytics } from 'firebase/analytics';
export type { Analytics as FirebaseAnalyticsType } from 'firebase/analytics';

export const Analytics = new InjectionToken<FirebaseAnalytics>('Analytics');

export function provideAnalytics(factory: () => FirebaseAnalytics): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Analytics,
      // `deps` forces FirebaseApp initialization before resolving Analytics.
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
