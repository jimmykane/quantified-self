'use strict';

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as requestPromise from '../request-helper';
import { getTokenData } from '../tokens';
import { getUserIDFromFirebaseToken, isCorsAllowed, setAccessControlHeadersOnResponse } from '../utils';
import { SERVICE_NAME } from './constants';


/**
 * Uploads an activity to Suunto app
 */
export const importActivityToSuuntoApp = functions.region('europe-west2').https.onRequest(async (req, res) => {
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

    // First init the upload
    let result: any;
    try {
      result = await requestPromise.post({
        headers: {
          'Authorization': serviceToken.accessToken,
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
          'json': true,
        },
        body: JSON.stringify({
          // description: "#qs",
          // comment: "",
          notifyUser: true,
        }),
        url: 'https://cloudapi.suunto.com/v2/upload/',
      });
      result = JSON.parse(result);
    } catch (e: any) {
      console.error(`Could init activity upload for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
      res.status(500);
      res.send(e.name);
      return;
    }

    let url = result.url;
    try {
      result = await requestPromise.put({
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          // json: true,
        },
        url,
        formData: {
          file: req.rawBody,
        },
      });
    } catch (e: any) {
      console.error(`Could upload activity for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
      res.status(500);
      res.send(e.message);
      return;
    }

    if (result.error) {
      console.error(`Could upload activity for token ${tokenQueryDocumentSnapshot.id} for user ${userID} due to service error`, result.error);
      res.status(500);
      res.send(result.error);
      return;
    }

    // 2nd attempt due to some reasons some fit files are not parsed and need raw body

    // First init the upload again
    try {
      result = await requestPromise.post({
        headers: {
          'Authorization': serviceToken.accessToken,
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
          'json': true,
        },
        body: JSON.stringify({
          // description: "#qs",
          // comment: "",
          notifyUser: true,
        }),
        url: 'https://cloudapi.suunto.com/v2/upload/',
      });
      result = JSON.parse(result);
    } catch (e: any) {
      console.error(`Could init activity upload for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
      res.status(500);
      res.send(e.name);
      return;
    }

    url = result.url;
    try {
      result = await requestPromise.put({
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          // json: true,
        },
        url,
        body: req.rawBody,
      });
    } catch (e: any) {
      console.error(`Could upload activity for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`, e);
      res.status(500);
      res.send(e.message);
      return;
    }

    if (result.error) {
      console.error(`Could upload activity for token ${tokenQueryDocumentSnapshot.id} for user ${userID} due to service error`, result.error);
      res.status(500);
      res.send(result.error);
      return;
    }
  }
  res.status(200);
  res.send();
});
