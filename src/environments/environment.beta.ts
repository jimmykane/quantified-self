// The file contents for the current environment will overwrite these during build.
// The build system defaults to the dev environment which uses `environment.ts`, but if you do
// `ng build --env=beta` then `environment.beta.ts` will be used instead.
// The list of which env maps to which file can be found in `.angular-cli.json`.
declare function require(moduleName: string): any;
const appVersion = require('../../package.json').version;

export const environment = {
  appVersion: appVersion,
  production: false,
  beta: true,
  localhost: false,
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
    recaptchaSiteKey: '6LfOOS0sAAAAAOqqukfJOPGUGC-h5REYwGTqPGpM'
  },
  functions: {
    createPortalLink: 'https://europe-west3-quantified-self-io.cloudfunctions.net/ext-firestore-stripe-payments-createPortalLink',
    restoreUserClaims: 'https://europe-west2-quantified-self-io.cloudfunctions.net/restoreUserClaims',
    deauthorizeSuuntoApp: 'https://europe-west2-quantified-self-io.cloudfunctions.net/deauthorizeSuuntoApp',
    uploadRoute: 'https://europe-west2-quantified-self-io.cloudfunctions.net/importRouteToSuuntoApp',
    uploadActivity: 'https://europe-west2-quantified-self-io.cloudfunctions.net/importActivityToSuuntoApp',
    getSuuntoFITFile: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getSuuntoFITFile',
    suuntoAPIHistoryImportURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/addSuuntoAppHistoryToQueue',
    stWorkoutDownloadAsFit: 'https://europe-west2-quantified-self-io.cloudfunctions.net/stWorkoutDownloadAsFit',
    getGarminHealthAPIAuthRequestTokenRedirectURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getGarminHealthAPIAuthRequestTokenRedirectURI',
    requestAndSetGarminHealthAPIAccessToken: 'https://europe-west2-quantified-self-io.cloudfunctions.net/requestAndSetGarminHealthAPIAccessToken',
    backfillHealthAPIActivities: 'https://europe-west2-quantified-self-io.cloudfunctions.net/backfillHealthAPIActivities',
    deauthorizeGarminHealthAPI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/deauthorizeGarminHealthAPI',
    getSuuntoAPIAuthRequestTokenRedirectURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getSuuntoAPIAuthRequestTokenRedirectURI',
    requestAndSetSuuntoAPIAccessToken: 'https://europe-west2-quantified-self-io.cloudfunctions.net/requestAndSetSuuntoAPIAccessToken',
    getCOROSAPIAuthRequestTokenRedirectURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getCOROSAPIAuthRequestTokenRedirectURI',
    requestAndSetCOROSAPIAccessToken: 'https://europe-west2-quantified-self-io.cloudfunctions.net/requestAndSetCOROSAPIAccessToken',
    deauthorizeCOROSAPI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/deauthorizeCOROSAPI',
    COROSAPIHistoryImportURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/addCOROSAPIHistoryToQueue',
    deleteSelf: 'https://europe-west2-quantified-self-io.cloudfunctions.net/deleteSelf',
    listUsers: 'https://europe-west2-quantified-self-io.cloudfunctions.net/listUsers',
  }
};
