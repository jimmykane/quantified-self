import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { RemoteConfig as FirebaseRemoteConfig } from 'firebase/remote-config';
import { FirebaseApp } from './app';

export * from 'firebase/remote-config';

export const RemoteConfig = new InjectionToken<FirebaseRemoteConfig>('RemoteConfig');

export function provideRemoteConfig(factory: () => FirebaseRemoteConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: RemoteConfig,
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
