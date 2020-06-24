'use strict';

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import QueryDocumentSnapshot = admin.firestore.QueryDocumentSnapshot;
import {suuntoApiAuth} from "./suunto/auth/auth";
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib/lib/service-tokens/oauth2-service-token.interface';

//
export const refreshTheRefreshTokens = functions.region('europe-west2').runWith({timeoutSeconds: 180}).pubsub.schedule('every 2 hours').onRun(async (context) => {
  console.log('This will be run every 2 hours!');
  // Suunto app refresh tokens should be refreshed every 180days we target at half days before 90 days
  const querySnapshot = await admin.firestore().collectionGroup('tokens').where("dateRefreshed", "<=", (new Date()).getTime() - (90 * 24 * 60 * 60 * 1000)).limit(50).get();
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

export async function getTokenData(doc: QueryDocumentSnapshot, forceRefreshAndSave = false): Promise<Auth2ServiceTokenInterface> {

  const serviceTokenData = <Auth2ServiceTokenInterface>doc.data();
  const oauth2 = suuntoApiAuth();
  // doc.data() is never undefined for query doc snapshots
  const token = oauth2.accessToken.create({
    'access_token': serviceTokenData.accessToken,
    'refresh_token': serviceTokenData.refreshToken,
    'expires_at': new Date(serviceTokenData.expiresAt) // We need to convert to date here for the lib to be able to check .expired()
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
    if (e.isBoom && e.output.statusCode === 401) {
      console.log(`Error with code 401 deleting token ${doc.id}`);
      try {
        await doc.ref.delete();
        console.log(`Deleted token ${doc.id} because of   response '${e.message}'`)
      } catch (e) {
        console.error(`Could not delete token ${doc.id}`);
      }
    }
    throw e;
  }

  await doc.ref.update(<Auth2ServiceTokenInterface>{
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
