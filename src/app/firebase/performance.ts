import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { FirebasePerformance } from 'firebase/performance';
import { FirebaseApp } from './app';

export { getPerformance } from 'firebase/performance';
export type { FirebasePerformance as FirebasePerformanceType } from 'firebase/performance';

export const Performance = new InjectionToken<FirebasePerformance>('Performance');

export function providePerformance(factory: () => FirebasePerformance): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Performance,
      // `deps` forces FirebaseApp initialization before resolving Performance.
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
