'use strict';
const fooFunction = require('./stWorkoutDownloadAsFit');

// Note do below initialization tasks in index.js and
// NOT in child functions:
const functions = require('firebase-functions');

// Pass database to child functions so they have access to it
exports.stWorkoutDownloadAsFit = functions.https.onRequest((req, res) => {
  fooFunction.handler(req, res, database);
});
