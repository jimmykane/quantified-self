import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteApp, getApps, initializeApp, provideFirebaseApp } from './app';
import { Auth, provideAuth } from './auth';
import { Firestore, provideFirestore } from './firestore';
import { Functions, provideFunctions } from './functions';
import { Storage, provideStorage } from './storage';
import { Analytics, provideAnalytics } from './analytics';
import { Performance, providePerformance } from './performance';
import { AppCheck, provideAppCheck } from './app-check';
import { RemoteConfig, provideRemoteConfig } from './remote-config';

const TEST_FIREBASE_CONFIG = {
  apiKey: 'test-api-key',
  authDomain: 'test.firebaseapp.com',
  projectId: 'test-project',
  appId: '1:1234567890:web:test',
};

afterEach(async () => {
  const apps = getApps();
  await Promise.all(apps.map((app) => deleteApp(app)));
  TestBed.resetTestingModule();
});

function expectFirebaseAppFactoryRunsBeforeFeatureFactory(
  token: unknown,
  provideFeature: (factory: () => unknown) => unknown
): void {
  const callOrder: string[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideFirebaseApp(() => {
        callOrder.push('app');
        return initializeApp(TEST_FIREBASE_CONFIG);
      }),
      provideFeature(() => {
        callOrder.push('feature');
        return {} as unknown;
      }) as never,
    ],
  });

  TestBed.inject(token as never);
  expect(callOrder).toEqual(['app', 'feature']);
}

describe('Firebase provider initialization ordering', () => {
  it('initializes FirebaseApp before Auth', () => {
    expectFirebaseAppFactoryRunsBeforeFeatureFactory(Auth, provideAuth);
  });

  it('initializes FirebaseApp before Firestore', () => {
    expectFirebaseAppFactoryRunsBeforeFeatureFactory(Firestore, provideFirestore);
  });

  it('initializes FirebaseApp before Functions', () => {
    expectFirebaseAppFactoryRunsBeforeFeatureFactory(Functions, provideFunctions);
  });

  it('initializes FirebaseApp before Storage', () => {
    expectFirebaseAppFactoryRunsBeforeFeatureFactory(Storage, provideStorage);
  });

  it('initializes FirebaseApp before Analytics', () => {
    expectFirebaseAppFactoryRunsBeforeFeatureFactory(Analytics, provideAnalytics);
  });

  it('initializes FirebaseApp before Performance', () => {
    expectFirebaseAppFactoryRunsBeforeFeatureFactory(Performance, providePerformance);
  });

  it('initializes FirebaseApp before AppCheck', () => {
    expectFirebaseAppFactoryRunsBeforeFeatureFactory(AppCheck, provideAppCheck);
  });

  it('initializes FirebaseApp before RemoteConfig', () => {
    expectFirebaseAppFactoryRunsBeforeFeatureFactory(RemoteConfig, provideRemoteConfig);
  });
});
