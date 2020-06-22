export const environment = {
  production: true,
  beta: false,
  localhost: false,
  firebase: {
    apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
    authDomain: 'quantified-self.io',
    databaseURL: 'https://quantified-self-io.firebaseio.com',
    projectId: 'quantified-self-io',
    storageBucket: 'quantified-self-io.appspot.com',
    messagingSenderId: '242713487388',
    appId: '1:242713487388:web:af0b3e931f2e96ed',
    measurementId: 'G-F8YB8P8091'
  },
  functions: {
    deauthorizeSuuntoAppServiceURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/deauthorize',
    uploadRoute: 'https://europe-west2-quantified-self-io.cloudfunctions.net/importRoute',
    getSuuntoFITFile: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getSuuntoFITFile',
    historyImportURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/addHistoryToQueue',
    stWorkoutDownloadAsFit: 'https://europe-west2-quantified-self-io.cloudfunctions.net/stWorkoutDownloadAsFit',
    getGarminAuthRequestTokenRedirectURI: 'https://europe-west2-quantified-self-io.cloudfunctions.net/getGarminAuthRequestTokenRedirectURI/',
  }
};
