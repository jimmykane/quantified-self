import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
  Auth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceConfig, GarminAPIAuth2ServiceTokenInterface } from './OAuth2';
import QueryDocumentSnapshot = admin.firestore.QueryDocumentSnapshot;
import QuerySnapshot = admin.firestore.QuerySnapshot;

//
export async function refreshTokens(querySnapshot: QuerySnapshot, serviceName: ServiceNames) {
  logger.info(`Found ${querySnapshot.size} auth tokens to process`);
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
    } catch (e) {
      logger.error(`Error parsing token #${count} of ${querySnapshot.size} and id ${authToken.id}`, e);
    }
  }
  logger.info(`Parsed ${count} auth tokens out of ${querySnapshot.size}`);
}

export async function getTokenData(doc: QueryDocumentSnapshot, serviceName: ServiceNames, forceRefreshAndSave = false): Promise<SuuntoAPIAuth2ServiceTokenInterface | COROSAPIAuth2ServiceTokenInterface | GarminAPIAuth2ServiceTokenInterface> {
  const serviceConfig = getServiceConfig(serviceName, true);
  const serviceTokenData = <Auth2ServiceTokenInterface>doc.data();
  // doc.data() is never undefined for query doc snapshots
  const token = serviceConfig.oauth2Client.createToken({
    'access_token': serviceTokenData.accessToken,
    'refresh_token': serviceTokenData.refreshToken,
    'expires_at': new Date(serviceTokenData.expiresAt), // We need to convert to date here for the lib to be able to check .expired()
  });

  if (!token.expired() && !forceRefreshAndSave) {
    logger.info(`Token is not expired won't refresh ${doc.id}`);
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
      case ServiceNames.GarminAPI:
        return <GarminAPIAuth2ServiceTokenInterface>{
          serviceName: serviceName,
          accessToken: serviceTokenData.accessToken,
          refreshToken: serviceTokenData.refreshToken,
          expiresAt: serviceTokenData.expiresAt,
          scope: serviceTokenData.scope,
          tokenType: serviceTokenData.tokenType,
          userID: (serviceTokenData as any).userID,
          permissions: (serviceTokenData as any).permissions, // Expose permissions
          permissionsLastChangedAt: (serviceTokenData as any).permissionsLastChangedAt,
          dateRefreshed: serviceTokenData.dateRefreshed,
          dateCreated: serviceTokenData.dateCreated,
        };
    }
  }

  if (token.expired()) {
    logger.info(`Token ${doc.id} has expired`);
  }

  let responseToken;
  const date = new Date();
  try {
    responseToken = await token.refresh();
    // COROS Exception for response
    if (responseToken.token.message && responseToken.token.message !== 'OK') {
      throw new Error('Something went wrong');
    }
    logger.info(`Successfully refreshed token ${doc.id}`);
  } catch (e: any) {
    const statusCode = e.statusCode || (e.output && e.output.statusCode);
    const errorDescription = e.message || (e.error && (e.error.error_description || e.error.error));

    // Suppress logging for 400/401/500 as these are expected during cleanup or due to partner issues
    if (statusCode === 401 || statusCode === 400 || statusCode === 500) {
      // Do not log the full stack trace for these known errors during cleanup
      logger.warn(`Token refresh for user ${doc.id} failed (${statusCode}): ${errorDescription}`);
    } else {
      logger.error(`Could not refresh token for user ${doc.id}`, e);
    }

    // If it's a 401 (Unauthorized) or 400 (Bad Request with invalid_grant), delete the token as it's no longer valid.
    if (statusCode === 401 || (statusCode === 400 && String(errorDescription).toLowerCase().includes('invalid_grant'))) {
      try {
        await doc.ref.delete();
        logger.info(`Deleted token ${doc.id} because it's no longer valid.`);
      } catch (deleteError: any) {
        logger.error(`Could not delete token ${doc.id}`, deleteError);
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
        expiresAt: (responseToken.token as any).expires_at.getTime() - 600000, // 600 seconds buffer per Garmin recommendation
        scope: responseToken.token.scope,
        tokenType: responseToken.token.token_type,
        userName: (responseToken.token as any).user,
        dateRefreshed: date.getTime(),
        dateCreated: serviceTokenData.dateCreated,
      };
      break;
    case ServiceNames.GarminAPI:
      newToken = <GarminAPIAuth2ServiceTokenInterface>{
        serviceName: serviceName,
        accessToken: responseToken.token.access_token,
        refreshToken: responseToken.token.refresh_token,
        expiresAt: (responseToken.token as any).expires_at.getTime() - 600000, // 600 seconds buffer per Garmin recommendation
        scope: responseToken.token.scope,
        tokenType: responseToken.token.token_type,
        userID: (serviceTokenData as any).userID, // Preserve User ID
        permissions: (serviceTokenData as any).permissions, // Preserve persist permissions
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
  logger.info(`Successfully saved refreshed token ${doc.id}`);
  return newToken;
}

/**
 * Refreshes tokens that are older than the stale threshold or have never been refreshed.
 *
 * @param {string} serviceName The name of the service (e.g., 'Suunto', 'COROS').
 * @param {number} staleThresholdDate The timestamp (ms) before which tokens are considered stale.
 */
export async function refreshStaleTokens(serviceName: string, staleThresholdDate: number): Promise<void> {
  const firestore = admin.firestore();

  // Query 1: Tokens older than the threshold
  const staleTokensQuery = firestore
    .collectionGroup('tokens')
    .where('serviceName', '==', serviceName)
    .where('dateRefreshed', '<=', staleThresholdDate)
    .limit(50)
    .get();

  // Query 2: Tokens with no refresh date (null)
  const missingDateRefreshedQuery = firestore
    .collectionGroup('tokens')
    .where('serviceName', '==', serviceName)
    .where('dateRefreshed', '==', null)
    .limit(50)
    .get();

  const [staleSnapshots, missingDateSnapshots] = await Promise.all([
    staleTokensQuery,
    missingDateRefreshedQuery,
  ]);

  await refreshTokens(staleSnapshots, serviceName as ServiceNames);
  await refreshTokens(missingDateSnapshots, serviceName as ServiceNames);
}
