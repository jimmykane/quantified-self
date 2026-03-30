import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { AppCheck as FirebaseAppCheck } from 'firebase/app-check';
import { FirebaseApp } from './app';

export { ReCaptchaV3Provider, getToken, initializeAppCheck } from 'firebase/app-check';
export type { AppCheck as FirebaseAppCheckType } from 'firebase/app-check';

export const AppCheck = new InjectionToken<FirebaseAppCheck>('AppCheck');

export function provideAppCheck(factory: () => FirebaseAppCheck): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: AppCheck,
      // `deps` forces FirebaseApp initialization before resolving AppCheck.
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
