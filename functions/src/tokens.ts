'use strict';

import * as admin from 'firebase-admin';
import {
  Auth2ServiceTokenInterface,
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib/lib/service-tokens/oauth2-service-token.interface';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import { getServiceConfig } from './OAuth2';
import QueryDocumentSnapshot = admin.firestore.QueryDocumentSnapshot;
import QuerySnapshot = admin.firestore.QuerySnapshot;

//
export async function refreshTokens(querySnapshot: QuerySnapshot, serviceName: ServiceNames) {
  console.log(`Found ${querySnapshot.size} auth tokens to process`);
  let count = 0;
  for (const authToken of querySnapshot.docs) {
    // If we are targeting Suunto App some tokens wont have a service name and those belong to Suunto app
    if (serviceName === ServiceNames.SuuntoApp && // Targeting suunto app
      authToken.data().serviceName && // They have a service name
      authToken.data().serviceName !== ServiceNames.SuuntoApp // It's not Suunto app
    ) {
      continue;
    }
    try {
      await getTokenData(authToken, serviceName, true);
      count++;
    } catch (e: any) {
      console.error(`Error parsing token #${count} of ${querySnapshot.size} and id ${authToken.id}`);
    }
  }
  console.log(`Parsed ${count} auth tokens out of ${querySnapshot.size}`);
}

export async function getTokenData(doc: QueryDocumentSnapshot, serviceName: ServiceNames, forceRefreshAndSave = false, useStaging = false): Promise<SuuntoAPIAuth2ServiceTokenInterface | COROSAPIAuth2ServiceTokenInterface> {
  const serviceConfig = getServiceConfig(serviceName, true);
  const serviceTokenData = <Auth2ServiceTokenInterface>doc.data();
  // doc.data() is never undefined for query doc snapshots
  const token = serviceConfig.oauth2Client.createToken({
    'access_token': serviceTokenData.accessToken,
    'refresh_token': serviceTokenData.refreshToken,
    'expires_at': new Date(serviceTokenData.expiresAt), // We need to convert to date here for the lib to be able to check .expired()
  });

  if (!token.expired() && !forceRefreshAndSave) {
    console.log(`Token is not expired won't refresh ${doc.id}`);
    switch (serviceName) {
      default:
        throw new Error('Not Implemented');
      case ServiceNames.COROSAPI:
        return <COROSAPIAuth2ServiceTokenInterface>{
          serviceName: serviceName,
          accessToken: serviceTokenData.accessToken,
          refreshToken: serviceTokenData.refreshToken,
          expiresAt: serviceTokenData.expiresAt,
          scope: serviceTokenData.scope,
          tokenType: serviceTokenData.tokenType,
          openId: serviceTokenData.openId,
          dateRefreshed: serviceTokenData.dateRefreshed,
          dateCreated: serviceTokenData.dateCreated,
        };
      case ServiceNames.SuuntoApp:
        return <SuuntoAPIAuth2ServiceTokenInterface>{
          serviceName: serviceName,
          accessToken: serviceTokenData.accessToken,
          refreshToken: serviceTokenData.refreshToken,
          expiresAt: serviceTokenData.expiresAt,
          scope: serviceTokenData.scope,
          tokenType: serviceTokenData.tokenType,
          userName: serviceTokenData.userName,
          dateRefreshed: serviceTokenData.dateRefreshed,
          dateCreated: serviceTokenData.dateCreated,
        };
    }
  }

  if (token.expired()) {
    console.log(`Token ${doc.id} has expired`);
  }

  let responseToken;
  const date = new Date();
  try {
    responseToken = await token.refresh();
    // COROS Exception for response
    if (responseToken.token.message && responseToken.token.message !== 'OK') {
      throw new Error('Something went wrong');
    }
    console.log(`Successfully refreshed token ${doc.id}`);
  } catch (e: any) {
    console.error(`Could not refresh token for user ${doc.id}`, e);
    if (e.isBoom && e.output.statusCode === 401) {
      console.log(`Error with code 401 deleting token ${doc.id}`);
      try {
        await doc.ref.delete();
        console.log(`Deleted token ${doc.id} because of   response '${e.message}'`);
      } catch (e: any) {
        console.error(`Could not delete token ${doc.id}`);
      }
    }
    throw e;
  }

  let newToken;
  switch (serviceName) {
    default:
      throw new Error('Not implemented');
    case ServiceNames.SuuntoApp:
      newToken = <SuuntoAPIAuth2ServiceTokenInterface>{
        serviceName: serviceName,
        accessToken: responseToken.token.access_token,
        refreshToken: responseToken.token.refresh_token,
        expiresAt: (responseToken.token as any).expires_at.getTime() - 6000,
        scope: responseToken.token.scope,
        tokenType: responseToken.token.token_type,
        userName: (responseToken.token as any).user,
        dateRefreshed: date.getTime(),
        dateCreated: serviceTokenData.dateCreated,
      };
      break;
    case ServiceNames.COROSAPI:
      newToken = <COROSAPIAuth2ServiceTokenInterface>serviceTokenData;
      newToken.expiresAt = date.getTime() - 6000;
      newToken.dateRefreshed = date.getTime();
      break;
  }

  await doc.ref.update(newToken as any);
  console.log(`Successfully saved refreshed token ${doc.id}`);
  return newToken;
}
