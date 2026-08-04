import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, PRO_REQUIRED_MESSAGE } from '../../utils';
import { hasServiceOAuthConnectAccess } from '../../service-oauth-access';
import {
  disconnectServiceForUser,
  getAndSetServiceOAuth2AccessTokenForUser,
  getServiceOAuth2CodeRedirectAndSaveStateToUser,
  validateOAuth2State,
} from '../../OAuth2';
import { SERVICE_NAME, WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../constants';
import { getWahooErrorLogDetails } from '../error-details';
import { setServiceConnectionProviderUserId } from '../../service-connection-meta';

async function requireWahooConnectAccess(request: { auth?: { uid: string } | null }): Promise<string> {
  enforceAppCheck(request as any);
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  if (!(await hasServiceOAuthConnectAccess(request.auth.uid, SERVICE_NAME))) {
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }
  return request.auth.uid;
}

export const getWahooAPIAuthRequestTokenRedirectURI = onCall({
  region: FUNCTIONS_MANIFEST.getWahooAPIAuthRequestTokenRedirectURI.region,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '256MiB',
  maxInstances: 10,
}, async (request): Promise<{ redirect_uri: string }> => {
  const userID = await requireWahooConnectAccess(request);
  const redirectUri = `${request.data?.redirectUri || ''}`.trim();
  if (!redirectUri) throw new HttpsError('invalid-argument', 'Missing redirect_uri');
  return {
    redirect_uri: await getServiceOAuth2CodeRedirectAndSaveStateToUser(userID, SERVICE_NAME, redirectUri),
  };
});

export const requestAndSetWahooAPIAccessToken = onCall({
  region: FUNCTIONS_MANIFEST.requestAndSetWahooAPIAccessToken.region,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '256MiB',
  maxInstances: 10,
}, async (request): Promise<void> => {
  const userID = await requireWahooConnectAccess(request);
  const state = `${request.data?.state || ''}`.trim();
  const code = `${request.data?.code || ''}`.trim();
  const redirectUri = `${request.data?.redirectUri || ''}`.trim();
  if (!state || !code || !redirectUri) {
    throw new HttpsError('invalid-argument', 'Missing state, code, or redirectUri');
  }
  if (!(await validateOAuth2State(userID, SERVICE_NAME, state))) {
    throw new HttpsError('permission-denied', 'Invalid OAuth state');
  }
  try {
    await getAndSetServiceOAuth2AccessTokenForUser(userID, SERVICE_NAME, redirectUri, code);
  } catch (error) {
    logger.error('Wahoo authorization code flow failed', getWahooErrorLogDetails(error));
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 429 || (statusCode && statusCode >= 500)) {
      throw new HttpsError('unavailable', 'Wahoo is temporarily unavailable.');
    }
    throw new HttpsError('internal', 'Wahoo authorization code flow failed.');
  }
});

export const deauthorizeWahooAPI = onCall({
  region: FUNCTIONS_MANIFEST.deauthorizeWahooAPI.region,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '256MiB',
  maxInstances: 10,
}, async (request): Promise<{ result: string }> => {
  enforceAppCheck(request);
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  try {
    await disconnectServiceForUser(request.auth.uid, SERVICE_NAME);
  } catch (error) {
    logger.error('Wahoo deauthorization failed', getWahooErrorLogDetails(error));
    throw new HttpsError('internal', 'Wahoo deauthorization failed.');
  }
  return { result: 'Deauthorized' };
});

/**
 * Repairs the safe Wahoo connection metadata for accounts connected before
 * providerUserId was added. It returns only the Wahoo account ID, never an
 * OAuth credential.
 */
export const getWahooAPIConnectionAccount = onCall({
  region: FUNCTIONS_MANIFEST.getWahooAPIConnectionAccount.region,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '256MiB',
  maxInstances: 10,
}, async (request): Promise<{ providerUserId: string | null }> => {
  enforceAppCheck(request);
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

  const tokenSnapshots = await admin.firestore()
    .collection(WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME)
    .doc(request.auth.uid)
    .collection('tokens')
    .limit(1)
    .get();
  const providerUserId = `${tokenSnapshots.docs[0]?.data()?.wahooUserID || ''}`.trim();
  if (!providerUserId) {
    return { providerUserId: null };
  }

  const didWrite = await setServiceConnectionProviderUserId(
    request.auth.uid,
    SERVICE_NAME,
    providerUserId,
  );
  return { providerUserId: didWrite ? providerUserId : null };
});
