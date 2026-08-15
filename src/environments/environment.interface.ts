export type FirebaseBackendMode = 'emulator' | 'hosted';
export type BillingMode = 'disabled' | 'stripe';

export interface LocalEmulatorPorts {
  app: number;
  auth: number;
  functions: number;
  firestore: number;
  storage: number;
  tasks: number;
  ui: number;
  hub: number;
}

export interface LocalEmulatorConfig {
  projectId: string;
  host: string;
  ports: LocalEmulatorPorts;
}

export interface AppEnvironment {
  appVersion: string;
  supportEmail: string;
  appUrl: string;
  production: boolean;
  beta: boolean;
  localhost: boolean;
  backendMode: FirebaseBackendMode;
  billingMode: BillingMode;
  analyticsEnabled: boolean;
  forceAnalyticsCollection: boolean;
  remoteConfigEnabled: boolean;
  appCheckEnabled: boolean;
  performanceEnabled: boolean;
  observabilityEnabled: boolean;
  useAuthEmulator: boolean;
  useFunctionsEmulator: boolean;
  emulatorConfig?: LocalEmulatorConfig;
  firebase: {
    apiKey: string;
    authDomain: string;
    databaseURL?: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
    recaptchaSiteKey: string;
  };
  googleMapsMapId: string;
  mapboxAccessToken: string;
}
