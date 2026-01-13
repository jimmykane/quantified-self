import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import {
  isCorsAllowed,
  setAccessControlHeadersOnResponse,
  getUserIDFromFirebaseToken,
  isProUser,
  PRO_REQUIRED_MESSAGE,
  determineRedirectURI
} from '../../utils';
import {
  getServiceOAuth2CodeRedirectAndSaveStateToUser,
  getAndSetServiceOAuth2AccessTokenForUser,
  deauthorizeServiceForUser,
  validateOAuth2State
} from '../../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as admin from 'firebase-admin';

const SERVICE_NAME = ServiceNames.GarminHealthAPI;

export const getGarminHealthAPIAuthRequestTokenRedirectURI = functions.region('europe-west2').https.onRequest(async (req, res) => {
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    logger.error('Not allowed');
    res.status(403).send('Unauthorized');
    return;
  }

  setAccessControlHeadersOnResponse(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).send();
    return;
  }

  const userID = await getUserIDFromFirebaseToken(req);
  if (!userID) {
    res.status(403).send('Unauthorized');
    return;
  }

  // Enforce Pro Access
  if (!(await isProUser(userID))) {
    logger.warn(`Blocking Garmin Auth for non-pro user ${userID}`);
    res.status(403).send(PRO_REQUIRED_MESSAGE);
    return;
  }

  const redirectURI = determineRedirectURI(req);
  if (!redirectURI) {
    res.status(400).send('Missing redirect_uri');
    return;
  }

  try {
    const url = await getServiceOAuth2CodeRedirectAndSaveStateToUser(userID, SERVICE_NAME, redirectURI);
    res.send({
      redirect_uri: url,
    });
  } catch (e: any) {
    logger.error(e);
    res.status(500).send('Internal Server Error');
  }
});

export const requestAndSetGarminHealthAPIAccessToken = functions.region('europe-west2').https.onRequest(async (req, res) => {
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    logger.error('Not allowed');
    res.status(403).send('Unauthorized');
    return;
  }

  setAccessControlHeadersOnResponse(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).send();
    return;
  }

  const userID = await getUserIDFromFirebaseToken(req);
  if (!userID) {
    res.status(403).send('Unauthorized');
    return;
  }

  // Enforce Pro Access
  if (!(await isProUser(userID))) {
    logger.warn(`Blocking Garmin Token Set for non-pro user ${userID}`);
    res.status(403).send(PRO_REQUIRED_MESSAGE);
    return;
  }

  const code = req.body.code;
  const state = req.body.state;
  const redirectUri = req.body.redirectUri;

  if (!code || !state || !redirectUri) {
    logger.error('Missing code, state, or redirectUri');
    res.status(400).send('Bad Request');
    return;
  }

  if (!await validateOAuth2State(userID, SERVICE_NAME, state)) {
    logger.error(`Invalid state ${state} for user ${userID}`);
    res.status(403).send('Unauthorized');
    return;
  }

  try {
    await getAndSetServiceOAuth2AccessTokenForUser(userID, SERVICE_NAME, redirectUri, code);
    res.send();
  } catch (e: any) {
    logger.error(e);
    res.status(500).send('Could not get access token for user');
  }
});


export const deauthorizeGarminHealthAPI = functions.region('europe-west2').https.onRequest(async (req, res) => {
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    logger.error('Not allowed');
    res.status(403).send('Unauthorized');
    return;
  }

  setAccessControlHeadersOnResponse(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).send();
    return;
  }

  const userID = await getUserIDFromFirebaseToken(req);
  if (!userID) {
    res.status(403).send('Unauthorized');
    return;
  }

  try {
    await deauthorizeServiceForUser(userID, SERVICE_NAME);
    res.status(200).send();
  } catch (e: any) {
    if (e.name === 'TokenNotFoundError') {
      res.status(404).send('Token not found');
    } else {
      logger.error(e);
      res.status(500).send('Bad request or internal error');
    }
  }
});

// Webhook for Garmin Deregistration
export const receiveGarminHealthAPIDeregistration = functions.region('europe-west2').https.onRequest(async (req, res) => {
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

  for (const deregistration of deregistrations) {
    const garminUserId = deregistration.userId;
    if (!garminUserId) continue;

    try {
      // Find the Firebase User(s) holding this Garmin connection
      // New Token Structure: garminHealthAPITokens/{firebaseUserID}/tokens/{garminUserID} with field `userID` == garminUserId
      const tokenQuerySnapshot = await admin.firestore()
        .collectionGroup('tokens')
        .where('userID', '==', garminUserId)
        .where('serviceName', '==', ServiceNames.GarminHealthAPI)
        .get();

      if (tokenQuerySnapshot.empty) {
        logger.info(`No active session found for Garmin User ID ${garminUserId}`);
        continue;
      }

      for (const tokenDoc of tokenQuerySnapshot.docs) {
        const firebaseUserID = tokenDoc.ref.parent.parent?.id;
        if (firebaseUserID) {
          logger.info(`Deauthorizing Firebase User ${firebaseUserID} (Garmin ID: ${garminUserId})`);
          try {
            await deauthorizeServiceForUser(firebaseUserID, ServiceNames.GarminHealthAPI);
          } catch (e) {
            logger.error(`Failed to deauthorize user ${firebaseUserID}`, e);
          }
        }
      }
    } catch (e: any) {
      logger.error(`Error processing deregistration for ${garminUserId}`, e);
    }
  }

  res.status(200).send();
});

// Webhook for Garmin User Permission Changes
// Per Section 2.6.3: Users can opt out of data sharing by turning off certain permissions.
// This webhook notifies us if those permissions change post-connection.
export const receiveGarminHealthAPIUserPermissions = functions.region('europe-west2').https.onRequest(async (req, res) => {
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

    // NOTE: We don't deauthorize here because the token is still valid.
    // The user has simply opted out of certain data types.
    // If all permissions are revoked, data will stop flowing, but we keep the connection.
    // If the user wants to fully disconnect, they would use the deregistration flow.
  }

  res.status(200).send();
});

// Alias for backwards compatibility if needed, or just remove the old export name
export const deauthorizeGarminHealthAPIUsers = receiveGarminHealthAPIDeregistration;
