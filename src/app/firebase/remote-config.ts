import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { RemoteConfig as FirebaseRemoteConfig } from 'firebase/remote-config';
import { FirebaseApp } from './app';

export { getRemoteConfig } from 'firebase/remote-config';
export type { RemoteConfig as FirebaseRemoteConfigType } from 'firebase/remote-config';

export const RemoteConfig = new InjectionToken<FirebaseRemoteConfig>('RemoteConfig');

export function provideRemoteConfig(factory: () => FirebaseRemoteConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: RemoteConfig,
      // `deps` forces FirebaseApp initialization before resolving RemoteConfig.
      useFactory: (_firebaseApp: unknown) => factory(),
      deps: [FirebaseApp]
    }
  ]);
}
