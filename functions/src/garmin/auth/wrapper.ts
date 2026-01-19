import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import {
  isProUser,
  PRO_REQUIRED_MESSAGE
} from '../../utils';
import {
  getServiceOAuth2CodeRedirectAndSaveStateToUser,
  getAndSetServiceOAuth2AccessTokenForUser,
  deauthorizeServiceForUser,
  deleteLocalServiceToken,
  validateOAuth2State
} from '../../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as admin from 'firebase-admin';

const SERVICE_NAME = ServiceNames.GarminAPI;

// Define Interfaces for Type Safety
interface GetAuthRedirectURIRequest {
  redirectUri: string;
}

interface SetAccessTokenRequest {
  code: string;
  state: string;
  redirectUri: string;
}

export const getGarminAPIAuthRequestTokenRedirectURI = functions.region('europe-west2').https.onCall(async (data: GetAuthRedirectURIRequest, context) => {
  // 1. App Check Verification
  if (context.app == undefined) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'The function must be called from an App Check verified app.'
    );
  }

  // 2. Auth Verification
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  const userID = context.auth.uid;

  // 3. Enforce Pro Access
  if (!(await isProUser(userID))) {
    logger.warn(`Blocking Garmin Auth for non-pro user ${userID}`);
    throw new functions.https.HttpsError(
      'permission-denied',
      PRO_REQUIRED_MESSAGE
    );
  }

  const redirectURI = data.redirectUri;
  if (!redirectURI) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing redirect_uri');
  }

  try {
    const url = await getServiceOAuth2CodeRedirectAndSaveStateToUser(userID, SERVICE_NAME, redirectURI);
    return {
      redirect_uri: url,
    };
  } catch (e: any) {
    logger.error('Error getting Garmin redirect URI:', e);
    const status = e.statusCode || 500;
    if (status === 502) {
      throw new functions.https.HttpsError('unavailable', 'Garmin service is temporarily unavailable');
    }
    throw new functions.https.HttpsError('internal', 'Internal Server Error');
  }
});

export const requestAndSetGarminAPIAccessToken = functions.region('europe-west2').https.onCall(async (data: SetAccessTokenRequest, context) => {
  // 1. App Check Verification
  if (context.app == undefined) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'The function must be called from an App Check verified app.'
    );
  }

  // 2. Auth Verification
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  const userID = context.auth.uid;

  // 3. Enforce Pro Access
  if (!(await isProUser(userID))) {
    logger.warn(`Blocking Garmin Token Set for non-pro user ${userID}`);
    throw new functions.https.HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const { code, state, redirectUri } = data;

  if (!code || !state || !redirectUri) {
    logger.error('Missing code, state, or redirectUri');
    throw new functions.https.HttpsError('invalid-argument', 'Missing code, state, or redirectUri');
  }

  if (!await validateOAuth2State(userID, SERVICE_NAME, state)) {
    logger.error(`Invalid state ${state} for user ${userID}`);
    throw new functions.https.HttpsError('permission-denied', 'Invalid state');
  }

  try {
    await getAndSetServiceOAuth2AccessTokenForUser(userID, SERVICE_NAME, redirectUri, code);
    return; // Success (return void/empty)
  } catch (e: any) {
    logger.error('Error exchanging Garmin token:', e);
    const status = e.statusCode || 500;
    if (status === 502) {
      throw new functions.https.HttpsError('unavailable', 'Garmin service is temporarily unavailable');
    }
    throw new functions.https.HttpsError('internal', 'Could not get access token for user');
  }
});


export const deauthorizeGarminAPI = functions.region('europe-west2').https.onCall(async (data: any, context) => {
  // 1. App Check Verification
  if (context.app == undefined) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'The function must be called from an App Check verified app.'
    );
  }

  // 2. Auth Verification
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  const userID = context.auth.uid;

  try {
    await deauthorizeServiceForUser(userID, SERVICE_NAME);
    return { success: true };
  } catch (e: any) {
    if (e.name === 'TokenNotFoundError') {
      throw new functions.https.HttpsError('not-found', 'Token not found');
    } else {
      logger.error('Error deauthorizing Garmin:', e);
      throw new functions.https.HttpsError('internal', 'Bad request or internal error');
    }
  }
});

// Webhook for Garmin Deregistration
export const receiveGarminAPIDeregistration = functions.region('europe-west2').https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // Validate payload (Garmin sends { deregistrations: [{ userId: '...' }] })
  if (!req.body.deregistrations || !Array.isArray(req.body.deregistrations)) {
    logger.warn('Invalid deregistration payload', req.body);
    res.status(200).send();
    return;
  }

  const deregistrations = req.body.deregistrations;
  logger.info(`Received ${deregistrations.length} deregistrations from Garmin`);

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (const deregistration of deregistrations) {
    const garminUserId = deregistration.userId;
    if (!garminUserId) {
      skippedCount++;
      continue;
    }

    try {
      // Find the Firebase User(s) holding this Garmin connection
      const tokenQuerySnapshot = await admin.firestore()
        .collectionGroup('tokens')
        .where('userID', '==', garminUserId)
        .where('serviceName', '==', ServiceNames.GarminAPI)
        .get();

      if (tokenQuerySnapshot.empty) {
        logger.info(`No active tokens found for Garmin User ID ${garminUserId}. Skipping.`);
        skippedCount++;
        continue;
      }

      for (const tokenDoc of tokenQuerySnapshot.docs) {
        const firebaseUserID = tokenDoc.ref.parent.parent?.id;
        if (firebaseUserID) {
          logger.info(`Processing deregistration for Firebase User ${firebaseUserID} (Garmin ID: ${garminUserId})`);
          try {
            await deleteLocalServiceToken(firebaseUserID, ServiceNames.GarminAPI, tokenDoc.id);
            successCount++;
          } catch (e) {
            logger.error(`Failed to process deregistration for Firebase User ${firebaseUserID} (Garmin ID: ${garminUserId})`, e);
            failCount++;
          }
        } else {
          logger.warn(`Could not determine Firebase User ID for Garmin ID ${garminUserId} from document ${tokenDoc.id}`);
          failCount++;
        }
      }
    } catch (e: any) {
      logger.error(`Error processing deregistration for Garmin User ID ${garminUserId}`, e);
      failCount++;
    }
  }

  logger.info(`Garmin deregistration batch complete. Summary: ${successCount} processed, ${failCount} failed, ${skippedCount} skipped/not found.`);

  res.status(200).send();
});

// Webhook for Garmin User Permission Changes
// Per Section 2.6.3: Users can opt out of data sharing by turning off certain permissions.
// This webhook notifies us if those permissions change post-connection.
export const receiveGarminAPIUserPermissions = functions.region('europe-west2').https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // Validate payload (Garmin sends { userPermissionsChange: [{ userId: '...', permissions: [...], ... }] })
  if (!req.body.userPermissionsChange || !Array.isArray(req.body.userPermissionsChange)) {
    logger.warn('Invalid user permissions payload', req.body);
    res.status(200).send();
    return;
  }

  const permissionChanges = req.body.userPermissionsChange;
  logger.info(`Received ${permissionChanges.length} permission changes from Garmin`);

  for (const change of permissionChanges) {
    const garminUserId = change.userId;
    const permissions = change.permissions;
    const changeTimeInSeconds = change.changeTimeInSeconds;

    if (!garminUserId) continue;

    // Log the permission change for monitoring
    // If permissions array is empty, user has revoked all data sharing (but token still valid)
    logger.info(`Garmin User ${garminUserId} permission change at ${changeTimeInSeconds}: ${JSON.stringify(permissions)}`);

    try {
      // Find the Firebase User(s) holding this Garmin connection
      const tokenQuerySnapshot = await admin.firestore()
        .collectionGroup('tokens')
        .where('userID', '==', garminUserId)
        .where('serviceName', '==', ServiceNames.GarminAPI)
        .get();

      if (tokenQuerySnapshot.empty) {
        logger.warn(`No active session found for Garmin User ID ${garminUserId} to update permissions`);
        continue;
      }

      const batch = admin.firestore().batch();
      let updateCount = 0;

      for (const tokenDoc of tokenQuerySnapshot.docs) {
        batch.update(tokenDoc.ref, {
          permissions: permissions,
          permissionsLastChangedAt: changeTimeInSeconds,
        });
        updateCount++;
      }

      if (updateCount > 0) {
        await batch.commit();
        logger.info(`Updated permissions for ${updateCount} tokens for Garmin User ${garminUserId}`);
      }
    } catch (e: any) {
      logger.error(`Error processing permission change for ${garminUserId}`, e);
    }
  }

  res.status(200).send();
});

// Alias for backwards compatibility if needed, or just remove the old export name
export const deauthorizeGarminAPIUsers = receiveGarminAPIDeregistration;
