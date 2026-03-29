import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { FirebaseStorage } from 'firebase/storage';
import { FirebaseApp } from './app';

export * from 'firebase/storage';

export const Storage = new InjectionToken<FirebaseStorage>('Storage');

export function provideStorage(factory: () => FirebaseStorage): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Storage,
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
