'use strict';

import * as functions from 'firebase-functions';
import { getUserIDFromFirebaseToken, isCorsAllowed, setAccessControlHeadersOnResponse } from '../../utils';
import {
  deauthorizeServiceForUser,
  getAndSetServiceOAuth2AccessTokenForUser,
  getServiceOAuth2CodeRedirectAndSaveStateToUser,
  validateOAuth2State,
} from '../../OAuth2';
import { SERVICE_NAME } from '../constants';


export const getCOROSAPIAuthRequestTokenRedirectURI = functions.region('europe-west2').https.onRequest(async (req, res) => {
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

  if (!req.body.redirectUri) {
    console.error('Missing redirectUri');
    res.status(500).send('Bad Request');
    return;
  }

  res.send({
    redirect_uri: await getServiceOAuth2CodeRedirectAndSaveStateToUser(userID, SERVICE_NAME, req.body.redirectUri),
  });
});

export const requestAndSetCOROSAPIAccessToken = functions.region('europe-west2').https.onRequest(async (req, res) => {
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
  const code = req.body.code;
  const redirectUri = req.body.redirectUri;

  if (!state || !code || !redirectUri) {
    console.error('Missing state or code or redirectUri');
    res.status(500).send('Bad Request');
    return;
  }

  if (!await validateOAuth2State(userID, SERVICE_NAME, state)) {
    res.status(403).send('Unauthorized');
    return;
  }
  try {
    await getAndSetServiceOAuth2AccessTokenForUser(userID, SERVICE_NAME, redirectUri, code);
  } catch (e: any) {
    console.error(e);
    res.status(500).send('Authorization code flow error');
  }
  res.status(200).send();
});


/**
 * Deauthorizes a COROS account
 */
export const deauthorizeCOROSAPI = functions.region('europe-west2').https.onRequest(async (req, res) => {
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

  try {
    await deauthorizeServiceForUser(userID, SERVICE_NAME);
  } catch (e: any) {
    console.error(e);
    res.status(500).send('Deauthorization Error');
  }
  res.status(200).send({ result: 'Deauthorized' });
});


