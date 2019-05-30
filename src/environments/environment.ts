// The file contents for the current environment will overwrite these during build.
// The build system defaults to the dev environment which uses `environment.ts`, but if you do
// `ng build --env=prod` then `environment.prod.ts` will be used instead.
// The list of which env maps to which file can be found in `.angular-cli.json`.

export const environment = {
  production: false,
  beta: false,
  localhost: true,
  firebase: {
    apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
    authDomain: 'quantified-self-io.firebaseapp.com',
    databaseURL: 'https://quantified-self-io.firebaseio.com',
    projectId: 'quantified-self-io',
    storageBucket: 'quantified-self-io.appspot.com',
    messagingSenderId: '242713487388',
  },
  functions: {
    deauthorizeSuuntoAppServiceURI: 'http://localhost:5000/quantified-self-io/europe-west2/deauthorize',
    historyImportURI: 'http://localhost:5000/quantified-self-io/europe-west2/addHistoryToQueue'
  }
};
