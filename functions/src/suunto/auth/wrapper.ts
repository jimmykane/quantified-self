'use strict';

import * as functions from 'firebase-functions'
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import {
  getUserIDFromFirebaseToken,
  isCorsAllowed,
  setAccessControlHeadersOnResponse
} from "../../utils";
import * as requestPromise from "request-promise-native";
import { suuntoApiAuth } from "./auth";
import { getTokenData } from "../../service-tokens";
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib/lib/service-tokens/oauth2-service-token.interface';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import { AccessToken } from 'simple-oauth2';


const OAUTH_SCOPES = 'workout';


export const getSuuntoAPIAuthRequestTokenRedirectURI = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    console.error(`Not allowed`);
    res.status(403);
    res.send('Unauthorized');
    return
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
  let redirectUri = req.body.redirectUri;

  if (!redirectUri) {
    console.error(`Missing redirectUri`);
    res.status(500).send('Bad Request');
    return;
  }

  const oauth2 = suuntoApiAuth();
  const state = crypto.randomBytes(20).toString('hex')
  redirectUri = oauth2.authorizeURL({
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    state: state
  });


  await admin.firestore().collection('suuntoAppAccessTokens').doc(userID).set({
    state: state
  })

  // Send the response wit hte prepeared stuff to the client and let him handle the state etc
  res.send({
    redirect_uri: redirectUri,
  })
});


export const requestAndSetSuuntoAPIAccessToken = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    console.error(`Not allowed`);
    res.status(403);
    res.send('Unauthorized');
    return
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

  const state = req.body.state
  const code = req.body.code;
  const redirectUri = req.body.redirectUri;

  if (!state || !code || !redirectUri) {
    console.error(`Missing state or code or redirectUri`);
    res.status(500).send('Bad Request');
    return;
  }

  const tokensDocumentSnapshotData = (await admin.firestore().collection('suuntoAppAccessTokens').doc(userID).get()).data();
  if (!tokensDocumentSnapshotData || !tokensDocumentSnapshotData.state) {
    res.status(500).send('Bad request');
    console.error('No token/state found')
    return;
  }

  if (state !== tokensDocumentSnapshotData.state) {
    console.error(`Invalid state ${state} vs ${tokensDocumentSnapshotData.state}`);
    res.status(403).send('Unauthorized');
    return;
  }

  const oauth2 = suuntoApiAuth();

  let results: AccessToken
  try {
    results = await oauth2.getToken({
      code: code,
      scope: OAUTH_SCOPES,
      // state: state,
      redirect_uri: redirectUri
    });

  } catch (e) {
    console.error(e);
    res.status(500).send('Authorization code flow error');
    return;
  }

  if (!results) {
    console.error(`No results for ${ServiceNames.SuuntoApp} Authorization access token call`);
    res.status(500).send('Bad request');
  }

  const currentDate = new Date();

  await admin.firestore()
    .collection('suuntoAppAccessTokens')
    .doc(userID).collection('tokens')
    .doc(results.token.user)
    .set(<Auth2ServiceTokenInterface>{
      accessToken: results.token.access_token,
      refreshToken: results.token.refresh_token,
      tokenType: results.token.token_type,
      expiresAt: currentDate.getTime() + (results.token.expires_in * 1000),
      scope: results.token.scope,
      userName: results.token.user,
      dateCreated: currentDate.getTime(),
      dateRefreshed: currentDate.getTime(),
    })

  console.log(`User ${userID} successfully connected to Suunto API`)
  res.status(200).send();
});


/**
 * Deauthorizes a Suunto app account upon user request
 */
export const deauthorizeSuuntoApp = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    console.error(`Not allowed `)
    res.status(403);
    res.send();
    return
  }

  setAccessControlHeadersOnResponse(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200);
    res.send();
    return;
  }

  if (!req.headers.authorization) {
    console.error(`No authorization'`);
    res.status(403);
    res.send();
    return
  }

  let decodedIdToken;
  try {
    decodedIdToken = await admin.auth().verifyIdToken(req.headers.authorization);
  } catch (e) {
    console.error(e);
    console.error(`Could not verify user token aborting operation`);
    res.status(500);
    res.send();
    return;
  }

  if (!decodedIdToken) {
    console.error(`Could not verify and decode token`);
    res.status(500);
    res.send();
    return;
  }

  const tokenQuerySnapshots = await admin.firestore().collection('suuntoAppAccessTokens').doc(decodedIdToken.uid).collection('tokens').get();

  console.log(`Found ${tokenQuerySnapshots.size} tokens for user ${decodedIdToken.uid}`);

  // Deauthorize all tokens for that user
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {

    let serviceToken;
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, true);
    } catch (e) {
      console.error(`Refreshing token failed skipping this token with id ${tokenQueryDocumentSnapshot.id}`);
      continue
    }

    try {
      await requestPromise.get({
        headers: {
          'Authorization': `Bearer ${serviceToken.accessToken}`,
        },
        url: `https://cloudapi-oauth.suunto.com/oauth/deauthorize?client_id=${functions.config().suuntoapp.client_id}`,
      });
      console.log(`Deauthorized token ${tokenQueryDocumentSnapshot.id} for ${decodedIdToken.uid}`)
    } catch (e) {
      console.error(e);
      console.error(`Could not deauthorize token ${tokenQueryDocumentSnapshot.id} for ${decodedIdToken.uid}`);
      res.status(500);
      res.send({result: 'Could not deauthorize'});
      return;
    }

    // Now get from all users the same username token
    // Note this will return the current doc as well
    const otherUsersTokensQuerySnapshot = await admin.firestore().collectionGroup('tokens').where("userName", "==", serviceToken.userName).get();

    console.log(`Found ${otherUsersTokensQuerySnapshot.size} tokens for token username ${serviceToken.userName}`);

    try {
      for (const otherUserQueryDocumentSnapshot of otherUsersTokensQuerySnapshot.docs) {
        await otherUserQueryDocumentSnapshot.ref.delete();
        console.log(`Deleted token ${otherUserQueryDocumentSnapshot.id}`);
      }
    } catch (e) {
      console.error(e);
      console.error(`Could not delete token ${tokenQueryDocumentSnapshot.id} for ${decodedIdToken.uid}`);
      res.status(500);
      res.send({result: 'Could not delete token'});
      return;
    }
    console.log(`Deleted successfully token ${tokenQueryDocumentSnapshot.id} for ${decodedIdToken.uid}`);
  }

  res.status(200);
  res.send({result: 'Deauthorized'});

});

