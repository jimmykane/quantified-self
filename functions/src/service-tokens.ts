'use strict';

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import QueryDocumentSnapshot = admin.firestore.QueryDocumentSnapshot;
import {suuntoAppAuth} from "./suunto-app-auth";
import {ServiceTokenInterface} from "quantified-self-lib/lib/service-tokens/service-token.interface";
//
export const refreshTheRefreshTokens = functions.region('europe-west2').runWith({timeoutSeconds: 180}).pubsub.schedule('every 2 hours').onRun(async (context) => {
  console.log('This will be run every 2 hours!');
  // Suunto app refresh tokens should be refreshed every 180days we target at 15 days before 165 days
  const querySnapshot = await admin.firestore().collectionGroup('tokens').where("dateRefreshed", "<=", (new Date()).getTime() - (165 * 24 * 60 * 60 * 1000)).limit(50).get();
  // Async foreach is ok here
  querySnapshot.forEach(async (doc) => {
    await refreshTokenIfNeeded(doc);
  });
});

// export const convertTokens = functions.region('europe-west2').runWith({timeoutSeconds: 180}).pubsub.schedule('every 2 hours').onRun(async (context) => {
//   console.log('This will be run every 2 hours!');
//   // Suunto app refresh tokens should be refreshed every 180days we target at 15 days before 165 days
//   const querySnapshot = await admin.firestore().collection('suuntoAppAccessTokens').get();
//
//   for (const doc of querySnapshot.docs){
//     const data = doc.data();
//     console.log(data);
//     await admin.firestore().collection('suuntoAppAccessTokens').doc(doc.id).collection('tokens').doc(data.userName).set(doc.data());
//   }
//
//   // Async foreach is ok here
//   // querySnapshot.forEach(async (doc) => {
//   //   await refreshTokenIfNeeded(doc);
//   // });
// });

export async function refreshTokenIfNeeded(doc: QueryDocumentSnapshot, forceRefresh = true) {
  const serviceToken = <ServiceTokenInterface>doc.data();
  const oauth2 = suuntoAppAuth();
  // doc.data() is never undefined for query doc snapshots
  const token = oauth2.accessToken.create({
    'access_token': serviceToken.accessToken,
    'refresh_token': serviceToken.refreshToken,
    'expires_at': serviceToken.expiresAt
  });

  if (!token.expired() && !forceRefresh){
    console.log(`Token is not expired won't refresh ${doc.id}`);
    return;
  }

  if (token.expired()){
    console.log(`Token ${doc.id} has expired`)
  }

  let responseToken;
  const date = new Date();
  try {
    responseToken = await token.refresh();
  } catch (e) {
    console.log(`Could not refresh token for user ${doc.id}`);
    if (e.code === 1) {
      console.log(`Error with code 1 deleting token ${doc.id}`);
      try {
        await doc.ref.delete();
      } catch (e) {
        console.error(`Could not delete token ${doc.id}`);
      }
    }
    return;
  }

  await doc.ref.update(<ServiceTokenInterface>{
      accessToken: responseToken.token.access_token,
      refreshToken: responseToken.token.refresh_token,
      expiresAt: responseToken.token.expires_at.getTime(),
      scope: responseToken.token.scope,
      tokenType: responseToken.token.token_type,
      userName: responseToken.token.user,
      dateRefreshed: date.getTime(),
  });

  console.log(`Successfully refreshed token ${doc.id}`);
}
