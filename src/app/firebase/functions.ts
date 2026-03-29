import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { Functions as FirebaseFunctions } from 'firebase/functions';
import { FirebaseApp } from './app';

export * from 'firebase/functions';

export const Functions = new InjectionToken<FirebaseFunctions>('Functions');

export function provideFunctions(factory: () => FirebaseFunctions): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Functions,
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
