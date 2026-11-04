import type { AppEnvironment } from './environment.interface';

// Entirely isolated from the normal hybrid local environment. No live project fallback.
export const environment: AppEnvironment = {
  appVersion: 'billing-test', supportEmail: 'support@quantified-self.io', appUrl: 'http://127.0.0.1:4210',
  production: false, beta: false, localhost: true, forceAnalyticsCollection: false,
  backendMode: 'emulator', billingMode: 'stripe', analyticsEnabled: false, remoteConfigEnabled: false,
  appCheckEnabled: false, performanceEnabled: false, observabilityEnabled: false,
  emulatorConfig: { projectId: 'demo-stripe-billing', host: '127.0.0.1',
    ports: { app: 4210, auth: 9191, functions: 5101, firestore: 8181, storage: 9291, tasks: 9511, ui: 4011, hub: 4411 } },
  useAuthEmulator: true, useFunctionsEmulator: true,
  firebase: { apiKey: 'demo-key', authDomain: 'localhost', databaseURL: 'http://127.0.0.1:9000',
    projectId: 'demo-stripe-billing', storageBucket: 'demo-stripe-billing.appspot.com',
    messagingSenderId: '123456789', appId: '1:123456789:web:billing', measurementId: '', recaptchaSiteKey: '' },
  googleMapsMapId: '', mapboxAccessToken: '',
};
