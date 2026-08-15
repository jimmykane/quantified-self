import type { AppEnvironment } from './environment.interface';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function assertEnvironmentSafety(candidate: AppEnvironment): void {
  if (candidate.backendMode !== 'emulator' && candidate.backendMode !== 'hosted') {
    throw new Error('[environment] backendMode must be emulator or hosted.');
  }
  if (candidate.billingMode !== 'disabled' && candidate.billingMode !== 'stripe') {
    throw new Error('[environment] billingMode must be disabled or stripe.');
  }

  if (candidate.backendMode !== 'emulator') {
    if (candidate.localhost && candidate.observabilityEnabled) {
      throw new Error('[environment] Observability must be disabled for localhost profiles.');
    }
    if (candidate.firebase.projectId.startsWith('demo-')) {
      throw new Error('[environment] Hosted mode cannot use a demo Firebase project.');
    }
    if (candidate.useAuthEmulator || candidate.useFunctionsEmulator || candidate.emulatorConfig) {
      throw new Error('[environment] Hosted mode cannot include Firebase emulator configuration.');
    }
    return;
  }

  if (!candidate.firebase.projectId.startsWith('demo-')) {
    throw new Error('[environment] Emulator mode requires a demo-* Firebase project ID.');
  }
  if (candidate.production || candidate.beta || !candidate.localhost) {
    throw new Error('[environment] Emulator mode requires non-production localhost build flags.');
  }
  if (candidate.billingMode !== 'disabled') {
    throw new Error('[environment] Billing must be disabled in emulator mode.');
  }
  if (!candidate.useAuthEmulator || !candidate.useFunctionsEmulator) {
    throw new Error('[environment] Emulator mode requires Auth and Functions emulator routing.');
  }
  if (candidate.analyticsEnabled || candidate.forceAnalyticsCollection || candidate.remoteConfigEnabled || candidate.appCheckEnabled
    || candidate.performanceEnabled || candidate.observabilityEnabled) {
    throw new Error('[environment] Hosted telemetry and configuration providers must be disabled in emulator mode.');
  }

  const emulatorConfig = candidate.emulatorConfig;
  if (!emulatorConfig || emulatorConfig.projectId !== candidate.firebase.projectId) {
    throw new Error('[environment] Emulator configuration must match the Firebase demo project.');
  }
  if (!LOOPBACK_HOSTS.has(emulatorConfig.host)) {
    throw new Error('[environment] Firebase emulators must use the supported loopback host 127.0.0.1 or localhost.');
  }

  const expectedOrigin = `http://${emulatorConfig.host}:${emulatorConfig.ports.app}`;
  try {
    const appUrl = new URL(candidate.appUrl);
    if (appUrl.origin !== expectedOrigin || appUrl.username || appUrl.password
      || appUrl.pathname !== '/' || appUrl.search || appUrl.hash) {
      throw new Error();
    }
  } catch {
    throw new Error(`[environment] Emulator appUrl must be exactly ${expectedOrigin}.`);
  }
}
