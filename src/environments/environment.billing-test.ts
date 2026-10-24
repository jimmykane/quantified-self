// Entirely isolated from the normal hybrid local environment. No live project fallback.
export const environment = {
  appVersion: 'billing-test', supportEmail: 'support@quantified-self.io', appUrl: 'http://127.0.0.1:4210',
  production: false, beta: false, localhost: true, forceAnalyticsCollection: false,
  useAuthEmulator: true, useFunctionsEmulator: true,
  firebase: { apiKey: 'demo-key', authDomain: 'localhost', databaseURL: 'http://127.0.0.1:9000',
    projectId: 'demo-stripe-billing', storageBucket: 'demo-stripe-billing.appspot.com',
    messagingSenderId: '123456789', appId: '1:123456789:web:billing', measurementId: '', recaptchaSiteKey: '' },
  googleMapsMapId: '', mapboxAccessToken: '',
};
