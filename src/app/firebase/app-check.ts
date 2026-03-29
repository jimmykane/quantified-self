import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { AppCheck as FirebaseAppCheck } from 'firebase/app-check';
import { FirebaseApp } from './app';

export * from 'firebase/app-check';

export const AppCheck = new InjectionToken<FirebaseAppCheck>('AppCheck');

export function provideAppCheck(factory: () => FirebaseAppCheck): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: AppCheck,
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
