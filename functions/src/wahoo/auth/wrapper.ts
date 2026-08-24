import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, PRO_REQUIRED_MESSAGE } from '../../utils';
import { hasServiceOAuthConnectAccess } from '../../service-oauth-access';
import {
  disconnectServiceForUser,
  getAndSetServiceOAuth2AccessTokenForUser,
  getServiceOAuth2CodeRedirectAndSaveStateToUser,
  isOAuthFlowContextMismatchError,
  isServiceDisconnectInProgressError,
  validateOAuth2State,
} from '../../OAuth2';
import { SERVICE_NAME } from '../constants';
import { getWahooErrorLogDetails } from '../error-details';
import { getServiceConnectionMeta } from '../../service-connection-meta';
import { FUNCTION_SECRET_BINDINGS } from '../../secrets';
import {
  getActiveWahooTokenSnapshot,
  isWahooOAuthAccountMismatchError,
  normalizeWahooUserID,
} from '../account';

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
  secrets: FUNCTION_SECRET_BINDINGS.getWahooAPIAuthRequestTokenRedirectURI,
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
  secrets: FUNCTION_SECRET_BINDINGS.requestAndSetWahooAPIAccessToken,
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
    await getAndSetServiceOAuth2AccessTokenForUser(userID, SERVICE_NAME, redirectUri, code, state);
  } catch (error) {
    logger.error('Wahoo authorization code flow failed', getWahooErrorLogDetails(error));
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (isOAuthFlowContextMismatchError(error)) {
      throw new HttpsError('permission-denied', 'Invalid OAuth state.');
    }
    if (isWahooOAuthAccountMismatchError(error)) {
      throw new HttpsError('failed-precondition', error.message);
    }
    if (statusCode === 403) {
      throw new HttpsError('permission-denied', 'Wahoo rejected the authorization request.');
    }
    if (statusCode === 429 || (statusCode && statusCode >= 500)) {
      throw new HttpsError('unavailable', 'Wahoo is temporarily unavailable.');
    }
    throw new HttpsError('internal', 'Wahoo authorization code flow failed.');
  }
});

export const deauthorizeWahooAPI = onCall({
  region: FUNCTIONS_MANIFEST.deauthorizeWahooAPI.region,
  secrets: FUNCTION_SECRET_BINDINGS.deauthorizeWahooAPI,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '256MiB',
  maxInstances: 10,
}, async (request): Promise<{ result: string }> => {
  enforceAppCheck(request);
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  try {
    await disconnectServiceForUser(request.auth.uid, SERVICE_NAME);
  } catch (error) {
    if (isServiceDisconnectInProgressError(error)) {
      logger.warn(`Wahoo disconnect is waiting for another connection operation for user ${request.auth.uid}.`);
      throw new HttpsError('unavailable', error.message, error.details);
    }
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

  const meta = await getServiceConnectionMeta(request.auth.uid, SERVICE_NAME);
  const pinnedProviderUserId = normalizeWahooUserID(meta?.providerUserId);
  if (pinnedProviderUserId) return { providerUserId: pinnedProviderUserId };

  try {
    const tokenSnapshot = await getActiveWahooTokenSnapshot(request.auth.uid);
    return { providerUserId: tokenSnapshot.id };
  } catch {
    return { providerUserId: null };
  }
});
