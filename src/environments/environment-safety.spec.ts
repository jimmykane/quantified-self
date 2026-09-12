import { describe, expect, it } from 'vitest';
import { assertEnvironmentSafety } from './environment-safety';
import type { AppEnvironment } from './environment.interface';
import { environment as betaEnvironment } from './environment.beta';
import { environment as localEnvironment } from './environment.local';
import { environment as hostedLocalEnvironment } from './environment.local.prod-functions';
import { environment as productionEnvironment } from './environment.prod';

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
  it('accepts every committed environment and keeps the default local one isolated', () => {
    expect(localEnvironment.backendMode).toBe('emulator');
    expect(localEnvironment.firebase.projectId).toBe('demo-quantified-self-local');
    expect(localEnvironment.billingMode).toBe('disabled');
    for (const committedEnvironment of [
      localEnvironment,
      hostedLocalEnvironment,
      betaEnvironment,
      productionEnvironment,
    ]) {
      expect(() => assertEnvironmentSafety(committedEnvironment)).not.toThrow();
    }
  });

  it('keeps observability disabled in the hosted localhost profile', () => {
    expect(hostedLocalEnvironment.backendMode).toBe('hosted');
    expect(hostedLocalEnvironment.localhost).toBe(true);
    expect(hostedLocalEnvironment.observabilityEnabled).toBe(false);
    expect(() => assertEnvironmentSafety({
      ...hostedLocalEnvironment,
      observabilityEnabled: true,
    })).toThrow(/Observability/);
  });

  it('accepts an isolated demo-project environment', () => {
    expect(() => assertEnvironmentSafety(buildEnvironment())).not.toThrow();
  });

  it('rejects unknown backend and billing modes instead of treating them as hosted', () => {
    expect(() => assertEnvironmentSafety(buildEnvironment({
      backendMode: 'unknown' as AppEnvironment['backendMode'],
    }))).toThrow(/backendMode/);
    expect(() => assertEnvironmentSafety(buildEnvironment({
      billingMode: 'unknown' as AppEnvironment['billingMode'],
    }))).toThrow(/billingMode/);
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
    expect(() => assertEnvironmentSafety(buildEnvironment({ forceAnalyticsCollection: true }))).toThrow(/telemetry/);
  });

  it('requires non-production flags and the exact loopback application origin', () => {
    expect(() => assertEnvironmentSafety(buildEnvironment({ production: true }))).toThrow(/non-production/);
    expect(() => assertEnvironmentSafety(buildEnvironment({ beta: true }))).toThrow(/non-production/);
    expect(() => assertEnvironmentSafety(buildEnvironment({ localhost: false }))).toThrow(/localhost/);
    expect(() => assertEnvironmentSafety(buildEnvironment({ appUrl: 'https://quantified-self.io' }))).toThrow(/appUrl/);
    expect(() => assertEnvironmentSafety(buildEnvironment({ appUrl: 'http://user@127.0.0.1:4200' }))).toThrow(/appUrl/);
    expect(() => assertEnvironmentSafety(buildEnvironment({ appUrl: 'http://127.0.0.1:4200/other' }))).toThrow(/appUrl/);
  });

  it('requires Auth and Functions emulator routing in emulator mode', () => {
    expect(() => assertEnvironmentSafety(buildEnvironment({ useAuthEmulator: false }))).toThrow(/Auth and Functions/);
    expect(() => assertEnvironmentSafety(buildEnvironment({ useFunctionsEmulator: false }))).toThrow(/Auth and Functions/);
  });

  it('rejects non-loopback emulator hosts', () => {
    const environment = buildEnvironment();
    environment.emulatorConfig = { ...environment.emulatorConfig!, host: '0.0.0.0' };

    expect(() => assertEnvironmentSafety(environment)).toThrow(/loopback/);
  });

  it('rejects unsupported IPv6 loopback URLs', () => {
    const environment = buildEnvironment();
    environment.emulatorConfig = { ...environment.emulatorConfig!, host: '::1' };

    expect(() => assertEnvironmentSafety(environment)).toThrow(/127\.0\.0\.1/);
  });

  it('accepts hosted production configuration and rejects hosted demo projects', () => {
    expect(() => assertEnvironmentSafety(buildEnvironment({
      backendMode: 'hosted',
      billingMode: 'stripe',
      appCheckEnabled: true,
      useAuthEmulator: false,
      useFunctionsEmulator: false,
      emulatorConfig: undefined,
      firebase: { ...buildEnvironment().firebase, projectId: 'quantified-self-io' },
    }))).not.toThrow();
    expect(() => assertEnvironmentSafety(buildEnvironment({
      backendMode: 'hosted',
      appCheckEnabled: true,
    }))).toThrow(/Hosted mode/);
  });

  it('rejects emulator configuration mixed into hosted mode', () => {
    const hosted = buildEnvironment({
      backendMode: 'hosted',
      appCheckEnabled: true,
      firebase: { ...buildEnvironment().firebase, projectId: 'quantified-self-io' },
    });

    expect(() => assertEnvironmentSafety(hosted)).toThrow(/emulator configuration/);
  });

  it('requires App Check for hosted profiles', () => {
    const hosted = buildEnvironment({
      backendMode: 'hosted',
      appCheckEnabled: false,
      useAuthEmulator: false,
      useFunctionsEmulator: false,
      emulatorConfig: undefined,
      firebase: { ...buildEnvironment().firebase, projectId: 'quantified-self-io' },
    });

    expect(() => assertEnvironmentSafety(hosted)).toThrow(/requires App Check/);
  });
});
