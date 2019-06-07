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
  console.log(`Found ${querySnapshot.size} auth tokens to process`);
  let count = 0;
  for (const authToken of querySnapshot.docs){
    try {
      await getTokenData(authToken, true);
      count++;
    }catch (e) {
      console.error(`Error parsing token #${count} of ${querySnapshot.size} and id ${authToken.id}`)
    }
  }
  console.log(`Parsed ${count} auth tokens out of ${querySnapshot.size}`);
});

export async function getTokenData(doc: QueryDocumentSnapshot, forceRefreshAndSave = false): Promise<ServiceTokenInterface> {

  const serviceTokenData = <ServiceTokenInterface>doc.data();
  const oauth2 = suuntoAppAuth();
  // doc.data() is never undefined for query doc snapshots
  const token = oauth2.accessToken.create({
    'access_token': serviceTokenData.accessToken,
    'refresh_token': serviceTokenData.refreshToken,
    'expires_at': serviceTokenData.expiresAt
  });

  if (!token.expired() && !forceRefreshAndSave){
    console.log(`Token is not expired won't refresh ${doc.id}`);
    return {
      accessToken: serviceTokenData.accessToken,
      refreshToken: serviceTokenData.refreshToken,
      expiresAt: serviceTokenData.expiresAt,
      scope: serviceTokenData.scope,
      tokenType: serviceTokenData.tokenType,
      userName: serviceTokenData.userName,
      dateRefreshed: serviceTokenData.dateRefreshed,
      dateCreated: serviceTokenData.dateCreated
    };
  }

  if (token.expired()){
    console.log(`Token ${doc.id} has expired`)
  }

  let responseToken;
  const date = new Date();
  try {
    responseToken = await token.refresh();
    console.log(`Successfully refreshed token ${doc.id}`);
  } catch (e) {
    console.error(`Could not refresh token for user ${doc.id}` ,e);
    // if (e.code === 1) {
    //   console.log(`Error with code 1 deleting token ${doc.id}`);
    //   try {
    //     await doc.ref.delete();
    //   } catch (e) {
    //     console.error(`Could not delete token ${doc.id}`);
    //   }
    // }
    return {
      accessToken: serviceTokenData.accessToken,
      refreshToken: serviceTokenData.refreshToken,
      expiresAt: serviceTokenData.expiresAt,
      scope: serviceTokenData.scope,
      tokenType: serviceTokenData.tokenType,
      userName: serviceTokenData.userName,
      dateRefreshed: serviceTokenData.dateRefreshed,
      dateCreated: serviceTokenData.dateCreated
    };
  }

  await doc.ref.update(<ServiceTokenInterface>{
      accessToken: responseToken.token.access_token,
      refreshToken: responseToken.token.refresh_token,
      expiresAt: responseToken.token.expires_at.getTime() - 6000,
      scope: responseToken.token.scope,
      tokenType: responseToken.token.token_type,
      userName: responseToken.token.user,
      dateRefreshed: date.getTime(),
  });

  console.log(`Successfully saved refreshed token ${doc.id}`);

  return {
    // We return all from the update except the date created
    accessToken: responseToken.token.access_token,
    refreshToken: responseToken.token.refresh_token,
    expiresAt: responseToken.token.expires_at.getTime() - 6000,
    scope: responseToken.token.scope,
    tokenType: responseToken.token.token_type,
    userName: responseToken.token.user,
    dateRefreshed: date.getTime(),
    dateCreated: serviceTokenData.dateCreated, // Date created comes from the original doc
  }

}
