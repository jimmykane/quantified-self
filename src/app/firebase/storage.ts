import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { FirebaseStorage } from 'firebase/storage';
import { FirebaseApp } from './app';

export { getBytes, getMetadata, getStorage, ref } from 'firebase/storage';
export type { FirebaseStorage as FirebaseStorageType } from 'firebase/storage';

export const Storage = new InjectionToken<FirebaseStorage>('Storage');

export function provideStorage(factory: () => FirebaseStorage): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: Storage,
      // `deps` forces FirebaseApp initialization before resolving Storage.
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
