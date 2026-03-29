import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { Analytics as FirebaseAnalytics } from 'firebase/analytics';
import { FirebaseApp } from './app';

export * from 'firebase/analytics';

export const Analytics = new InjectionToken<FirebaseAnalytics>('Analytics');

export function provideAnalytics(factory: () => FirebaseAnalytics): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Analytics,
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
