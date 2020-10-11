// The file contents for the current environment will overwrite these during build.
// The build system defaults to the dev environment which uses `environment.ts`, but if you do
// `ng build --env=prod` then `environment.prod.ts` will be used instead.
// The list of which env maps to which file can be found in `.angular-cli.json`.

export const environment = {
  production: false,
  beta: false,
  localhost: true,
  firebase: {
     apiKey: "AIzaSyB9LTcP36lqTWltgB3p0fM5q8oBA6EIRy0",
    authDomain: "quantified-self-dopanik.firebaseapp.com",
    databaseURL: "https://quantified-self-dopanik.firebaseio.com",
    projectId: "quantified-self-dopanik",
    storageBucket: "quantified-self-dopanik.appspot.com",
    messagingSenderId: "87812803840",
    appId: "1:87812803840:web:9b511827655a32457eb7e5",
    measurementId: "G-089WTZ1FKV"
  },
  functions: {
    deauthorizeSuuntoApp: 'http://localhost:5000/quantified-self-io/europe-west2/deauthorizeSuuntoApp',
    uploadRoute: 'http://localhost:5000/quantified-self-io/europe-west2/importRouteToSuuntoApp',
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
