// The file contents for the current environment will overwrite these during build.
// The build system defaults to the dev environment which uses `environment.ts`, but if you do
// `ng build --env=beta` then `environment.beta.ts` will be used instead.
// The list of which env maps to which file can be found in `.angular-cli.json`.

export const environment = {
  production: false,
  beta: true,
  localhost: false,
  firebase: {
    apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
    authDomain: 'beta.quantified-self.io',
    databaseURL: 'https://quantified-self-io.firebaseio.com',
    projectId: 'quantified-self-io',
    storageBucket: 'quantified-self-io.appspot.com',
    messagingSenderId: '242713487388',
    appId: '1:242713487388:web:df287e1940b40a90',
    measurementId: 'G-6YE27NNKDT'
  },
  functions: {
    deauthorizeSuuntoAppURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/deauthorizeSuuntoApp',
    uploadRoute: 'https://europe-west2-quantified-self-io.cloudfunctions.net/importRouteToSuuntoApp',
    getSuuntoFITFile: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getSuuntoFITFile',
    historyImportURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/addSuuntoAppHistoryToQueue',
    stWorkoutDownloadAsFit: 'https://europe-west2-quantified-self-io.cloudfunctions.net/stWorkoutDownloadAsFit',
    getGarminHealthAPIAuthRequestTokenRedirectURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getGarminHealthAPIAuthRequestTokenRedirectURI',
    requestAndSetGarminHealthAPIAccessToken: 'https://europe-west2-quantified-self-io.cloudfunctions.net/requestAndSetGarminHealthAPIAccessToken',
    backfillHealthAPIActivities: 'https://europe-west2-quantified-self-io.cloudfunctions.net/backfillHealthAPIActivities',
    deauthorizeGarminHealthAPI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/deauthorizeGarminHealthAPI',
  }
};
