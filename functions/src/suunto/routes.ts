'use strict';

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as requestPromise from '../request-helper';
import { getTokenData } from '../tokens';
import { getUserIDFromFirebaseToken, isCorsAllowed, setAccessControlHeadersOnResponse } from '../utils';
import * as Pako from 'pako';
import { SERVICE_NAME } from './constants';


/**
 * Uploads a route to the Suunto app
 */
export const importRouteToSuuntoApp = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    console.error('Not allowed');
    res.status(403);
    res.send('Unauthorized');
    return;
  }

  setAccessControlHeadersOnResponse(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200);
    res.send();
    return;
  }

  const userID = await getUserIDFromFirebaseToken(req);
  if (!userID) {
    res.status(403).send('Unauthorized');
    return;
  }

  if (!req.body) {
    console.error('No file provided\'');
    res.status(500);
    res.send();
    return;
  }

  const tokenQuerySnapshots = await admin.firestore().collection('suuntoAppAccessTokens').doc(userID).collection('tokens').get();
  console.log(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, SERVICE_NAME, false);
    } catch (e: any) {
      console.error(`Refreshing token failed skipping this token with id ${tokenQueryDocumentSnapshot.id}`);
      res.status(500);
      res.send(e.name);
      return;
    }
    let result: any;
    try {
      result = await requestPromise.post({
        headers: {
          'Authorization': serviceToken.accessToken,
          'Content-Type': 'application/gpx+xml',
          'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
          // json: true,
        },
        body: Pako.ungzip(Buffer.from(req.body, 'base64'), { to: 'string' }),
        url: 'https://cloudapi.suunto.com/v2/route/import',
      });
      result = JSON.parse(result);
      // console.log(`Deauthorized token ${doc.id} for ${decodedIdToken.uid}`)
    } catch (e: any) {
      console.error(`Could upload route for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
      res.status(500);
      res.send(e.name);
      return;
    }

    if (result.error) {
      console.error(`Could upload route for token ${tokenQueryDocumentSnapshot.id} for user ${userID} due to service error`, result.error);
      res.status(500);
      res.send(result.error);
      return;
    }
    try {
      const userServiceMetaDocumentSnapshot = await admin.firestore().collection('users').doc(userID).collection('meta').doc(SERVICE_NAME).get();
      const data = userServiceMetaDocumentSnapshot.data();
      let uploadedRoutesCount = 0;
      if (data) {
        uploadedRoutesCount = data.uploadedRoutesCount || uploadedRoutesCount;
      }
      await userServiceMetaDocumentSnapshot.ref.update({
        uploadedRoutesCount: uploadedRoutesCount + 1,
      });
    } catch (e: any) {
      console.error('Could not update uploadedRoutes count');
    }
  }
  res.status(200);
  res.send();
});
