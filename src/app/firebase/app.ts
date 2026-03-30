import {
  ENVIRONMENT_INITIALIZER,
  EnvironmentProviders,
  InjectionToken,
  inject,
  makeEnvironmentProviders
} from '@angular/core';
import {
  FirebaseApp as FirebaseAppInstance,
  FirebaseOptions,
  deleteApp,
  getApp as getFirebaseApp,
  getApps,
  initializeApp as initializeFirebaseApp
} from 'firebase/app';

export type { FirebaseApp as FirebaseAppType, FirebaseOptions } from 'firebase/app';
export { deleteApp, getApps };

export const FirebaseApp = new InjectionToken<FirebaseAppInstance>('FirebaseApp');

export function provideFirebaseApp(factory: () => FirebaseAppInstance): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: FirebaseApp,
      useFactory: factory
    },
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        inject(FirebaseApp);
      }
    }
  ]);
}

export function initializeApp(options: FirebaseOptions, name?: string): FirebaseAppInstance {
  return initializeFirebaseApp(options, name);
}

export function getApp(name?: string): FirebaseAppInstance {
  return getFirebaseApp(name);
}
