import type { AppEnvironment } from './environment.interface';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function assertEnvironmentSafety(candidate: AppEnvironment): void {
  if (candidate.backendMode !== 'emulator') {
    if (candidate.firebase.projectId.startsWith('demo-')) {
      throw new Error('[environment] Hosted mode cannot use a demo Firebase project.');
    }
    return;
  }

  if (!candidate.firebase.projectId.startsWith('demo-')) {
    throw new Error('[environment] Emulator mode requires a demo-* Firebase project ID.');
  }
  if (candidate.billingMode !== 'disabled') {
    throw new Error('[environment] Billing must be disabled in emulator mode.');
  }
  if (candidate.analyticsEnabled || candidate.remoteConfigEnabled || candidate.appCheckEnabled
    || candidate.performanceEnabled || candidate.observabilityEnabled) {
    throw new Error('[environment] Hosted telemetry and configuration providers must be disabled in emulator mode.');
  }

  const emulatorConfig = candidate.emulatorConfig;
  if (!emulatorConfig || emulatorConfig.projectId !== candidate.firebase.projectId) {
    throw new Error('[environment] Emulator configuration must match the Firebase demo project.');
  }
  if (!LOOPBACK_HOSTS.has(emulatorConfig.host)) {
    throw new Error('[environment] Firebase emulators must bind to a loopback host.');
  }
}
