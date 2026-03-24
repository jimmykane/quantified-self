import { mapboxAccessToken } from './mapbox-token';
declare function require(moduleName: string): any;
const appVersion = require('../../package.json').version;

export const environment = {
  appVersion: appVersion,
  supportEmail: 'support@quantified-self.io',
  appUrl: 'http://localhost:4200',
  production: false,
  beta: false,
  localhost: true,
  forceAnalyticsCollection: true,
  useAuthEmulator: false,
  useFunctionsEmulator: false,
  firebase: {
    apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
    authDomain: 'quantified-self.io',
    databaseURL: 'https://quantified-self-io.firebaseio.com',
    projectId: 'quantified-self-io',
    storageBucket: 'quantified-self-io',
    messagingSenderId: '242713487388',
    appId: '1:242713487388:web:df287e1940b40a90',
    measurementId: 'G-6YE27NNKDT',
    recaptchaSiteKey: '6Lfi_EwsAAAAACWwUUff0cd4E-92EJnXEwFuOSzz'
  },
  googleMapsMapId: '1192252b0032f7559388bd8a',
  mapboxAccessToken,
};
