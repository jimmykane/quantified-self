'use strict';

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as requestPromise from '../request-helper';
import { getTokenData } from '../tokens';
import { isCorsAllowed, setAccessControlHeadersOnResponse } from '../utils';
import { SERVICE_NAME } from './constants';

/**
 * Downloads the original file
 */
export const getSuuntoFITFile = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    console.error('Not allowed');
    res.status(403);
    res.send();
    return;
  }

  setAccessControlHeadersOnResponse(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200);
    res.send();
    return;
  }

  if (!req.headers.authorization) {
    console.error('No authorization\'');
    res.status(403);
    res.send();
    return;
  }

  if (!req.body.workoutID || !req.body.userName) {
    console.error('No \'workoutID\' or \'userName\' provided');
    res.status(500);
    res.send();
    return;
  }

  let decodedIdToken;
  try {
    decodedIdToken = await admin.auth().verifyIdToken(req.headers.authorization);
  } catch (e: any) {
    console.error(e);
    console.error('Could not verify user token aborting operation');
    res.status(500);
    res.send();
    return;
  }

  if (!decodedIdToken) {
    console.error('Could not verify and decode token');
    res.status(500);
    res.send();
    return;
  }

  const tokenQuerySnapshots = await admin.firestore().collection('suuntoAppAccessTokens').doc(decodedIdToken.uid).collection('tokens').get();
  console.log(`Found ${tokenQuerySnapshots.size} tokens for user ${decodedIdToken.uid}`);

  let serviceTokenToUse;
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, SERVICE_NAME, false);
    } catch (e: any) {
      console.error(`Refreshing token failed skipping this token with id ${tokenQueryDocumentSnapshot.id}`);
      res.status(500);
      res.send();
      return;
    }
    // Only download for the specific user
    if (serviceToken.userName === req.body.userName) {
      serviceTokenToUse = serviceToken;
    }
  }

  if (!serviceTokenToUse) {
    console.info('No service token for this userName and workoutID found');
    res.status(404);
    res.send();
    return;
  }

  let result;
  try {
    console.time('GetFIT');
    result = await requestPromise.get({
      headers: {
        'Authorization': serviceTokenToUse.accessToken,
        'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
      },
      encoding: null,
      // gzip: true,
      url: `https://cloudapi.suunto.com/v2/workout/exportFit/${req.body.workoutID}`,
    });
    console.timeEnd('GetFIT');
    console.log(`Downloaded FIT file for ${req.body.workoutID} and token user ${serviceTokenToUse.userName}`);
  } catch (e: any) {
    if (e.statusCode === 403) {
      console.error(new Error(`Could not get workout for ${req.body.workoutID} and token user ${serviceTokenToUse.userName} due to 403`));
    }
    if (e.statusCode === 500) {
      console.error(new Error(`Could not get workout for ${req.body.workoutID} and token user ${serviceTokenToUse.userName} due to 403`));
    }
    console.error(new Error(`Could not get workout for ${req.body.workoutID} and token user ${serviceTokenToUse.userName}.`));
    res.status(e.statusCode);
    res.send();
    return;
  }

  console.log('Sending response');
  res.status(200);
  res.send(result);
});
