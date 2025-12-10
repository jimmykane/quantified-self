import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

export const generateSummaries = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Should get input granulariy
  const eventQuerySnapshots = admin.firestore().collection('users')
    .doc('u2rQqTs1tYNrwKXo2go1XLqoOl23')
    .collection('events').select().limit(300).get();
  console.log(eventQuerySnapshots);
});
