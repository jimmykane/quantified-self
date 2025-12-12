// The file contents for the current environment will overwrite these during build.
// The build system defaults to the dev environment which uses `environment.ts`, but if you do
// `ng build --env=prod` then `environment.prod.ts` will be used instead.
// The list of which env maps to which file can be found in `.angular-cli.json`.
declare function require(moduleName: string): any;
const appVersion = require('../../package.json').version;


export const environment = {
  appVersion: appVersion,
  production: false,
  beta: false,
  localhost: true,
  useAuthEmulator: false, // Set to true to use Firebase Auth Emulator
  firebase: {
    apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
    authDomain: 'quantified-self-io.firebaseapp.com',
    databaseURL: 'https://quantified-self-io.firebaseio.com',
    projectId: 'quantified-self-io',
    storageBucket: 'quantified-self-io',
    messagingSenderId: '242713487388',
    appId: '1:242713487388:web:df287e1940b40a90',
    measurementId: 'G-6YE27NNKDT'
  },
  functions: {
    deauthorizeSuuntoApp: 'http://localhost:5000/quantified-self-io/europe-west2/deauthorizeSuuntoApp',
    uploadRoute: 'http://localhost:5000/quantified-self-io/europe-west2/importRouteToSuuntoApp',
    uploadActivity: 'http://localhost:5000/quantified-self-io/europe-west2/importActivityToSuuntoApp',
    getSuuntoFITFile: 'http://localhost:5000/quantified-self-io/europe-west2/getSuuntoFITFile',
    suuntoAPIHistoryImportURI: 'http://localhost:5000/quantified-self-io/europe-west2/addSuuntoAppHistoryToQueue',
    stWorkoutDownloadAsFit: 'http://localhost:5000/quantified-self-io/europe-west2/stWorkoutDownloadAsFit/',
    getGarminHealthAPIAuthRequestTokenRedirectURI: 'http://localhost:5000/quantified-self-io/europe-west2/getGarminHealthAPIAuthRequestTokenRedirectURI',
    requestAndSetGarminHealthAPIAccessToken: 'http://localhost:5000/quantified-self-io/europe-west2/requestAndSetGarminHealthAPIAccessToken',
    backfillHealthAPIActivities: 'http://localhost:5000/quantified-self-io/europe-west2/backfillHealthAPIActivities',
    deauthorizeGarminHealthAPI: 'http://localhost:5000/quantified-self-io/europe-west2/deauthorizeGarminHealthAPI',
    getSuuntoAPIAuthRequestTokenRedirectURI: 'http://localhost:5000/quantified-self-io/europe-west2/getSuuntoAPIAuthRequestTokenRedirectURI',
    requestAndSetSuuntoAPIAccessToken: 'http://localhost:5000/quantified-self-io/europe-west2/requestAndSetSuuntoAPIAccessToken',
    getCOROSAPIAuthRequestTokenRedirectURI: 'http://localhost:5000/quantified-self-io/europe-west2/getCOROSAPIAuthRequestTokenRedirectURI',
    requestAndSetCOROSAPIAccessToken: 'http://localhost:5000/quantified-self-io/europe-west2/requestAndSetCOROSAPIAccessToken',
    deauthorizeCOROSAPI: 'http://localhost:5000/quantified-self-io/europe-west2/deauthorizeCOROSAPI',
    COROSAPIHistoryImportURI: 'http://localhost:5000/quantified-self-io/europe-west2/addCOROSAPIHistoryToQueue',
  }
};
