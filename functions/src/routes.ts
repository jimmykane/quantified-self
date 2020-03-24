'use strict';

import * as functions from 'firebase-functions'
import * as admin from "firebase-admin";
import * as requestPromise from "request-promise-native";
import { getTokenData } from "./service-tokens";
import { isCorsAllowed, setAccessControlHeadersOnResponse } from "./auth";
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/meta-data.interface';

/**
 * Uploads a route to the Suunto app
 */
export const importRoute = functions.region('europe-west2').https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    console.error(`Not allowed`);
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

  if (!req.body) {
    console.error(`No file provided'`);
    res.status(500);
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

  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, false);
    } catch (e) {
      console.error(`Refreshing token failed skipping this token with id ${tokenQueryDocumentSnapshot.id}`);
      res.status(500);
      res.send();
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
        body: req.body,
        url: `https://cloudapi.suunto.com/v2/route/import`,
      });
      result = JSON.parse(result);
      // console.log(`Deauthorized token ${doc.id} for ${decodedIdToken.uid}`)
    } catch (e) {
      console.error(`Could upload route for token ${tokenQueryDocumentSnapshot.id} for user ${decodedIdToken.uid}`, e);
      res.status(500);
      res.send();
      return;
    }

    if (result.error) {
      console.error(`Could upload route for token ${tokenQueryDocumentSnapshot.id} for user ${decodedIdToken.uid} due to service error`, result.error);
      res.status(500);
      res.send();
      return;
    }
    try {
      const userServiceMetaDocumentSnapshot = await admin.firestore().collection('users').doc(decodedIdToken.uid).collection('meta').doc(ServiceNames.SuuntoApp).get();
      const data = userServiceMetaDocumentSnapshot.data();
      let uploadedRoutesCount = 0
      if (data){
        uploadedRoutesCount = data.uploadedRoutesCount || uploadedRoutesCount;
      }
      await userServiceMetaDocumentSnapshot.ref.update({
        uploadedRoutesCount: uploadedRoutesCount + 1
      })
    }catch (e) {
      console.error(`Could not update uploadedRoutes count`);
    }

    res.status(200)
    res.send();
  }
});
