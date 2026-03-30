import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { Functions as FirebaseFunctions } from 'firebase/functions';
import { FirebaseApp } from './app';

export {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  httpsCallableFromURL
} from 'firebase/functions';
export type { Functions as FirebaseFunctionsType } from 'firebase/functions';

export const Functions = new InjectionToken<FirebaseFunctions>('Functions');

export function provideFunctions(factory: () => FirebaseFunctions): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Functions,
      // `deps` forces FirebaseApp initialization before resolving Functions.
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
