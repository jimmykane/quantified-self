'use strict';

import * as functions from 'firebase-functions'
import { GarminHealthAPIAuth } from './garmin-health-api-auth';
import * as requestPromise from 'request-promise-native';
import { isCorsAllowed, setAccessControlHeadersOnResponse } from '../..';
import { getUserIDFromFirebaseToken } from '../../utils';


// const OAUTH_SCOPES = 'workout';
const REQUEST_TOKEN_URI = 'https://connectapi.garmin.com/oauth-service/oauth/request_token'
const REQUEST_TOKEN_CONFIRMATION_URI = 'https://connect.garmin.com/oauthConfirm'
const ACCESS_TOKEN_URI = 'https://connectapi.garmin.com/oauth-service/oauth/access_token'

/**
 */
export const getGarminAuthRequestTokenRedirectURI = functions.region('europe-west2').https.onRequest(async (req, res) => {

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
  if (!userID){
    res.status(403).send('Unauthorized');
    return;
  }

  // Should only allow post
  const oAuth = GarminHealthAPIAuth();

  let result
  result = await requestPromise.post({
    headers: oAuth.toHeader(oAuth.authorize({
      url: REQUEST_TOKEN_URI,
      method: 'POST'
    })),
    url: REQUEST_TOKEN_URI,
  });

  const urlParams = new URLSearchParams(result);

  // Send the response wit hte prepeared stuff to the client and let him handle the state etc
  res.send({
    redirect_url: REQUEST_TOKEN_CONFIRMATION_URI,
    oauth_token: urlParams.get('oauth_token'),
    oauth_token_secret: urlParams.get('oauth_token_secret'),
  })
});


export const garminAuthAccessToken = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // @todo handle error

  const oAuth = GarminHealthAPIAuth();
  const d = oAuth.toHeader(oAuth.authorize({
    url: ACCESS_TOKEN_URI,
    method: 'POST',
    data: {
      oauth_verifier: req.query.oauth_verifier,
      oauth_token_secret: req.query.oauth_token_secret,
      // oauth_token: {
      //   oauth_token: req.query.oauth_token, oauth_token_secret: req.query.oauth_token_secret
      // }
    }
  }, {
    key: req.query.oauth_token,
    secret: req.query.oauth_token_secret
  }))
  console.log(d)
  let result
  result = await requestPromise.post({
    headers: d,
    url: ACCESS_TOKEN_URI,
  });

  console.log(result);

  // @todo should save per user
  debugger;
  res.send();
});


