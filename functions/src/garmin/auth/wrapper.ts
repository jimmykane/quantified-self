'use strict';

import * as functions from 'firebase-functions';
import { GarminHealthAPIAuth } from './auth';
import * as requestPromise from '../../request-helper';
import { isCorsAllowed, setAccessControlHeadersOnResponse } from '../../index';
import { getUserIDFromFirebaseToken } from '../../utils';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';


// const OAUTH_SCOPES = 'workout';
const REQUEST_TOKEN_URI = 'https://connectapi.garmin.com/oauth-service/oauth/request_token';
const REQUEST_TOKEN_CONFIRMATION_URI = 'https://connect.garmin.com/oauthConfirm';
const ACCESS_TOKEN_URI = 'https://connectapi.garmin.com/oauth-service/oauth/access_token';
const DEREGISTRATION_URI = 'https://healthapi.garmin.com/wellness-api/rest/user/registration';

// Other
const USER_ID_URI = 'https://healthapi.garmin.com/wellness-api/rest/user/id';

/**
 */
export const getGarminHealthAPIAuthRequestTokenRedirectURI = functions.region('europe-west2').https.onRequest(async (req, res) => {
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

  const oAuth = GarminHealthAPIAuth();

  let result;
  result = await requestPromise.post({
    headers: oAuth.toHeader(oAuth.authorize({
      url: REQUEST_TOKEN_URI,
      method: 'POST',
    })),
    url: REQUEST_TOKEN_URI,
  });

  const urlParams = new URLSearchParams(result);

  const state = crypto.randomBytes(20).toString('hex');
  await admin.firestore().collection('garminHealthAPITokens').doc(userID).set({
    oauthToken: urlParams.get('oauth_token'),
    oauthTokenSecret: urlParams.get('oauth_token_secret'),
    state: state,
  });

  // Send the response wit hte prepeared stuff to the client and let him handle the state etc
  res.send({
    redirect_uri: REQUEST_TOKEN_CONFIRMATION_URI,
    oauthToken: urlParams.get('oauth_token'),
    state: state,
  });
});


export const requestAndSetGarminHealthAPIAccessToken = functions.region('europe-west2').https.onRequest(async (req, res) => {
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

  const state = req.body.state;
  const oauthVerifier = req.body.oauthVerifier;

  if (!state || !oauthVerifier) {
    console.error('Missing state or oauthVerifier');
    res.status(500).send('Bad Request');
    return;
  }

  const tokensDocumentSnapshotData = (await admin.firestore().collection('garminHealthAPITokens').doc(userID).get()).data();
  if (!tokensDocumentSnapshotData || !tokensDocumentSnapshotData.state || !tokensDocumentSnapshotData.oauthToken || !tokensDocumentSnapshotData.oauthTokenSecret) {
    res.status(500).send('Bad request');
    console.error('No token/state found');
    return;
  }

  if (state !== tokensDocumentSnapshotData.state) {
    console.error(`Invalid state ${state} vs ${tokensDocumentSnapshotData.state}`);
    res.status(403).send('Unauthorized');
    return;
  }

  const oAuth = GarminHealthAPIAuth();

  let result;
  try {
    result = await requestPromise.post({
      headers: oAuth.toHeader(oAuth.authorize({
        url: ACCESS_TOKEN_URI,
        method: 'POST',
        data: {
          oauth_verifier: oauthVerifier,
        },
      }, {
        key: tokensDocumentSnapshotData.oauthToken,
        secret: tokensDocumentSnapshotData.oauthTokenSecret,
      })),
      url: ACCESS_TOKEN_URI,
    });
  } catch (e: any) {
    console.error(e);
    res.status(500).send('Could not get access token for user');
    return;
  }

  const urlParams = new URLSearchParams(result);

  try {
    result = await requestPromise.get({
      headers: oAuth.toHeader(oAuth.authorize({
        url: USER_ID_URI,
        method: 'get',
      },
        {
          key: urlParams.get('oauth_token'),
          secret: urlParams.get('oauth_token_secret'),
        })),
      url: USER_ID_URI,
    });
  } catch (e: any) {
    console.error(e);
    res.status(500).send('Could not get user for access token');
    return;
  }

  await admin.firestore().collection('garminHealthAPITokens').doc(userID).set({
    accessToken: urlParams.get('oauth_token'),
    accessTokenSecret: urlParams.get('oauth_token_secret'),
    dateCreated: (new Date()).getTime(),
    userID: JSON.parse(result).userId,
  });

  console.log(`User ${userID} successfully connected to Garmin API`);
  res.send();
});


export const deauthorizeGarminHealthAPI = functions.region('europe-west2').https.onRequest(async (req, res) => {
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

  const tokensDocumentSnapshotData = (await admin.firestore().collection('garminHealthAPITokens').doc(userID).get()).data();
  if (!tokensDocumentSnapshotData || !tokensDocumentSnapshotData.accessToken || !tokensDocumentSnapshotData.accessTokenSecret) {
    res.status(500).send('Bad request');
    console.error('No token found');
    return;
  }

  const oAuth = GarminHealthAPIAuth();

  try {
    await requestPromise.delete({
      headers: oAuth.toHeader(oAuth.authorize({
        url: DEREGISTRATION_URI,
        method: 'DELETE',
      }, {
        key: tokensDocumentSnapshotData.accessToken,
        secret: tokensDocumentSnapshotData.accessTokenSecret,
      })),
      url: DEREGISTRATION_URI,
    });
  } catch (e: any) {
    // Only if there is an api error in terms
    if (e.statusCode === 500) {
      console.error(e);
      res.status(500).send();
      return;
    }
  }
  await admin.firestore().collection('garminHealthAPITokens').doc(userID).delete();
  res.status(200).send();
});


export const deauthorizeGarminHealthAPIUsers = functions.region('europe-west2').https.onRequest(async (req, res) => {
  if (!req.body.deregistrations || !req.body.deregistrations.length) {
    console.info(req.body);
    res.status(200).send();
    return;
  }
  const deregistrations = req.body.deregistrations;

  console.log(`Deauthorizing ${deregistrations.length} users`);
  for (const deregistration of deregistrations) {
    try {
      const tokenQuerySnapshots = await admin.firestore()
        .collection('garminHealthAPITokens')
        .where('userID', '==', deregistration.userId)
        .where('accessToken', '==', deregistration.userAccessToken)
        .get();
      console.log(`Found ${tokenQuerySnapshots.size} to delete`);
      for (const tokenQuerySnapshotsDocument of tokenQuerySnapshots.docs) {
        await tokenQuerySnapshotsDocument.ref.delete();
      }
    } catch (e: any) {
      console.error(e);
    }
  }
  console.info(`Successfully deauthorized ${deregistrations.length}`);
  res.status(200);
  res.write('SUCCESS');
  res.send();
});
