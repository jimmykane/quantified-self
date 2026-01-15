'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { getUserIDFromFirebaseToken, isCorsAllowed, setAccessControlHeadersOnResponse, isProUser, PRO_REQUIRED_MESSAGE } from '../../utils';
import {
  deauthorizeServiceForUser,
  getAndSetServiceOAuth2AccessTokenForUser,
  getServiceOAuth2CodeRedirectAndSaveStateToUser,
  validateOAuth2State,
} from '../../OAuth2';
import { determineRedirectURI } from '../../utils';
import { SERVICE_NAME } from '../constants';


export const getCOROSAPIAuthRequestTokenRedirectURI = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    logger.error('Not allowed');
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

  // Enforce Pro Access
  if (!(await isProUser(userID))) {
    logger.warn(`Blocking COROS Auth for non-pro user ${userID}`);
    res.status(403).send(PRO_REQUIRED_MESSAGE);
    return;
  }

  const redirectURI = determineRedirectURI(req);
  if (!redirectURI) {
    res.status(400).send('Missing redirect_uri');
    return;
  }
  res.send({
    redirect_uri: await getServiceOAuth2CodeRedirectAndSaveStateToUser(userID, SERVICE_NAME, redirectURI),
  });
});

export const requestAndSetCOROSAPIAccessToken = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    logger.error('Not allowed');
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

  // Enforce Pro Access
  if (!(await isProUser(userID))) {
    logger.warn(`Blocking COROS Token Set for non-pro user ${userID}`);
    res.status(403).send(PRO_REQUIRED_MESSAGE);
    return;
  }

  const state = req.body.state;
  const code = req.body.code;
  const redirectUri = determineRedirectURI(req);

  if (!state || !code || !redirectUri) {
    logger.error('Missing state or code or redirectUri');
    res.status(400).send('Bad Request');
    return;
  }

  if (!await validateOAuth2State(userID, SERVICE_NAME, state)) {
    res.status(403).send('Unauthorized');
    return;
  }
  try {
    await getAndSetServiceOAuth2AccessTokenForUser(userID, SERVICE_NAME, redirectUri, code);
  } catch (e: any) {
    logger.error(e);
    const status = e.statusCode || (e.output && e.output.statusCode) || 500;
    res.status(status).send(status === 502 ? 'COROS service is temporarily unavailable' : 'Authorization code flow error');
  }
  res.status(200).send();
});


/**
 * Deauthorizes a COROS account
 */
export const deauthorizeCOROSAPI = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    logger.error('Not allowed');
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
    logger.error(e);
    res.status(500).send('Deauthorization Error');
  }
  res.status(200).send({ result: 'Deauthorized' });
});
