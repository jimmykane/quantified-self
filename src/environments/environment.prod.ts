declare function require(moduleName: string): any;
const appVersion = require('../../package.json').version;
export const environment = {
  appVersion: appVersion,
  supportEmail: 'support@quantified-self.io',
  production: true,
  beta: false,
  localhost: false,
  forceAnalyticsCollection: true,
  useAuthEmulator: false,
  firebase: {
    apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
    authDomain: 'quantified-self.io',
    databaseURL: 'https://quantified-self-io.firebaseio.com',
    projectId: 'quantified-self-io',
    storageBucket: 'quantified-self-io',
    messagingSenderId: '242713487388',
    appId: '1:242713487388:web:af0b3e931f2e96ed',
    measurementId: 'G-F8YB8P8091',
    recaptchaSiteKey: '6Lfi_EwsAAAAACWwUUff0cd4E-92EJnXEwFuOSzz'
  },

};
