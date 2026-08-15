import { describe, expect, it } from 'vitest';
import { assertEnvironmentSafety } from './environment-safety';
import type { AppEnvironment } from './environment.interface';

function buildEnvironment(overrides: Partial<AppEnvironment> = {}): AppEnvironment {
  return {
    appVersion: 'test',
    supportEmail: 'test@example.test',
    appUrl: 'http://127.0.0.1:4200',
    production: false,
    beta: false,
    localhost: true,
    backendMode: 'emulator',
    billingMode: 'disabled',
    analyticsEnabled: false,
    forceAnalyticsCollection: false,
    remoteConfigEnabled: false,
    appCheckEnabled: false,
    performanceEnabled: false,
    observabilityEnabled: false,
    useAuthEmulator: true,
    useFunctionsEmulator: true,
    emulatorConfig: {
      projectId: 'demo-test',
      host: '127.0.0.1',
      ports: { app: 4200, auth: 9099, functions: 5001, firestore: 8081, storage: 9199, tasks: 9499, ui: 4000, hub: 4400 },
    },
    firebase: {
      apiKey: 'demo',
      authDomain: 'demo-test.firebaseapp.com',
      projectId: 'demo-test',
      storageBucket: 'demo-test.appspot.com',
      messagingSenderId: '0',
      appId: 'demo',
      recaptchaSiteKey: 'disabled',
    },
    googleMapsMapId: '',
    mapboxAccessToken: '',
    ...overrides,
  };
}

describe('assertEnvironmentSafety', () => {
  it('accepts an isolated demo-project environment', () => {
    expect(() => assertEnvironmentSafety(buildEnvironment())).not.toThrow();
  });

  it('rejects emulator mode pointed at a real project', () => {
    const environment = buildEnvironment({
      firebase: { ...buildEnvironment().firebase, projectId: 'quantified-self-io' },
    });

    expect(() => assertEnvironmentSafety(environment)).toThrow(/demo-\*/);
  });

  it('rejects billing or hosted providers in emulator mode', () => {
    expect(() => assertEnvironmentSafety(buildEnvironment({ billingMode: 'stripe' }))).toThrow(/Billing/);
    expect(() => assertEnvironmentSafety(buildEnvironment({ analyticsEnabled: true }))).toThrow(/telemetry/);
  });

  it('rejects non-loopback emulator hosts', () => {
    const environment = buildEnvironment();
    environment.emulatorConfig = { ...environment.emulatorConfig!, host: '0.0.0.0' };

    expect(() => assertEnvironmentSafety(environment)).toThrow(/loopback/);
  });

  it('accepts hosted production configuration and rejects hosted demo projects', () => {
    expect(() => assertEnvironmentSafety(buildEnvironment({
      backendMode: 'hosted',
      billingMode: 'stripe',
      firebase: { ...buildEnvironment().firebase, projectId: 'quantified-self-io' },
    }))).not.toThrow();
    expect(() => assertEnvironmentSafety(buildEnvironment({ backendMode: 'hosted' }))).toThrow(/Hosted mode/);
  });
});
