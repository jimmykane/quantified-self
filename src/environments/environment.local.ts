import localRuntimeConfig from '../../local-runtime.config.json';
import { mapboxAccessToken } from './mapbox-token';
import type { AppEnvironment, LocalEmulatorConfig } from './environment.interface';

declare function require(moduleName: string): any;
const appVersion = require('../../package.json').version;

export const environment: AppEnvironment = {
  appVersion,
  supportEmail: 'support@quantified-self.io',
  appUrl: `http://${localRuntimeConfig.host}:${localRuntimeConfig.ports.app}`,
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
  emulatorConfig: localRuntimeConfig as LocalEmulatorConfig,
  firebase: {
    apiKey: 'demo-local-api-key',
    authDomain: `${localRuntimeConfig.projectId}.firebaseapp.com`,
    databaseURL: `https://${localRuntimeConfig.projectId}.firebaseio.com`,
    projectId: localRuntimeConfig.projectId,
    storageBucket: `${localRuntimeConfig.projectId}.appspot.com`,
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:local',
    recaptchaSiteKey: 'local-app-check-disabled',
  },
  googleMapsMapId: '',
  mapboxAccessToken,
};
