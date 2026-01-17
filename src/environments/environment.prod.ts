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
  functions: {
    createPortalLink: 'https://europe-west3-quantified-self-io.cloudfunctions.net/ext-firestore-stripe-payments-createPortalLink',
    restoreUserClaims: 'https://europe-west2-quantified-self-io.cloudfunctions.net/restoreUserClaims',
    linkExistingStripeCustomer: 'https://europe-west2-quantified-self-io.cloudfunctions.net/linkExistingStripeCustomer',
    cleanupStripeCustomer: 'https://europe-west2-quantified-self-io.cloudfunctions.net/cleanupStripeCustomer',
    deauthorizeSuuntoApp: 'https://europe-west2-quantified-self-io.cloudfunctions.net/deauthorizeSuuntoApp',
    uploadRoute: 'https://europe-west2-quantified-self-io.cloudfunctions.net/importRouteToSuuntoApp',
    uploadActivity: 'https://europe-west2-quantified-self-io.cloudfunctions.net/importActivityToSuuntoApp',
    getSuuntoFITFile: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getSuuntoFITFile',
    suuntoAPIHistoryImportURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/addSuuntoAppHistoryToQueue',
    stWorkoutDownloadAsFit: 'https://europe-west2-quantified-self-io.cloudfunctions.net/stWorkoutDownloadAsFit',
    getGarminAPIAuthRequestTokenRedirectURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getGarminAPIAuthRequestTokenRedirectURI',
    requestAndSetGarminAPIAccessToken: 'https://europe-west2-quantified-self-io.cloudfunctions.net/requestAndSetGarminAPIAccessToken',
    backfillGarminAPIActivities: 'https://europe-west2-quantified-self-io.cloudfunctions.net/backfillGarminAPIActivities',
    deauthorizeGarminAPI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/deauthorizeGarminAPI',
    getSuuntoAPIAuthRequestTokenRedirectURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getSuuntoAPIAuthRequestTokenRedirectURI',
    requestAndSetSuuntoAPIAccessToken: 'https://europe-west2-quantified-self-io.cloudfunctions.net/requestAndSetSuuntoAPIAccessToken',
    getCOROSAPIAuthRequestTokenRedirectURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getCOROSAPIAuthRequestTokenRedirectURI',
    requestAndSetCOROSAPIAccessToken: 'https://europe-west2-quantified-self-io.cloudfunctions.net/requestAndSetCOROSAPIAccessToken',
    deauthorizeCOROSAPI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/deauthorizeCOROSAPI',
    COROSAPIHistoryImportURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/addCOROSAPIHistoryToQueue',

  }
};
