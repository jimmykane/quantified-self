// The file contents for the current environment will overwrite these during build.
// The build system defaults to the dev environment which uses `environment.ts`, but if you do
// `ng build --env=beta` then `environment.beta.ts` will be used instead.
// The list of which env maps to which file can be found in `.angular-cli.json`.
declare function require(moduleName: string): any;
const appVersion = require('../../package.json').version;

export const environment = {
  appVersion: appVersion,
  supportEmail: 'support@quantified-self.io',
  production: false,
  beta: true,
  localhost: false,
  forceAnalyticsCollection: true,
  useAuthEmulator: false,
  firebase: {
    apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
    authDomain: 'beta.quantified-self.io',
    databaseURL: 'https://quantified-self-io.firebaseio.com',
    projectId: 'quantified-self-io',
    storageBucket: 'quantified-self-io',
    messagingSenderId: '242713487388',
    appId: '1:242713487388:web:df287e1940b40a90',
    measurementId: 'G-6YE27NNKDT',
    recaptchaSiteKey: '6Lfi_EwsAAAAACWwUUff0cd4E-92EJnXEwFuOSzz'
  },

};
