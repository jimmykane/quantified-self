'use strict';

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { PRO_REQUIRED_MESSAGE, ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../../utils';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  disconnectServiceForUser,
  getAndSetServiceOAuth2AccessTokenForUser,
  getServiceOAuth2CodeRedirectAndSaveStateToUser,
  isOAuthFlowContextMismatchError,
  isServiceDisconnectInProgressError,
  validateOAuth2State,
} from '../../OAuth2';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { hasServiceOAuthConnectAccess } from '../../service-oauth-access';
import { extractRefreshFailureDetails } from '../../service-auth-lifecycle';
import { FUNCTION_SECRET_BINDINGS } from '../../secrets';

const SERVICE_NAME = ServiceNames.SuuntoApp;


interface GetAuthRedirectURIRequest {
  redirectUri: string;
}

interface GetAuthRedirectURIResponse {
  redirect_uri: string;
}

export const getSuuntoAPIAuthRequestTokenRedirectURI = onCall({
  region: FUNCTIONS_MANIFEST.getSuuntoAPIAuthRequestTokenRedirectURI.region,
  secrets: FUNCTION_SECRET_BINDINGS.getSuuntoAPIAuthRequestTokenRedirectURI,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '256MiB',
  maxInstances: 10
}, async (request): Promise<GetAuthRedirectURIResponse> => {
  // App Check verification
  enforceAppCheck(request);

  // Auth verification
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userID = request.auth.uid;

  // Enforce Pro Access
  if (!(await hasServiceOAuthConnectAccess(userID, SERVICE_NAME))) {
    logger.warn(`Blocking Suunto Auth for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const { redirectUri } = request.data as GetAuthRedirectURIRequest;
  if (!redirectUri) {
    throw new HttpsError('invalid-argument', 'Missing redirect_uri');
  }

  return {
    redirect_uri: await getServiceOAuth2CodeRedirectAndSaveStateToUser(userID, SERVICE_NAME, redirectUri),
  };
});


interface SetAccessTokenRequest {
  state: string;
  code: string;
  redirectUri: string;
}

export const requestAndSetSuuntoAPIAccessToken = onCall({
  region: FUNCTIONS_MANIFEST.requestAndSetSuuntoAPIAccessToken.region,
  secrets: FUNCTION_SECRET_BINDINGS.requestAndSetSuuntoAPIAccessToken,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '256MiB',
  maxInstances: 10
}, async (request): Promise<void> => {
  // App Check verification
  enforceAppCheck(request);

  // Auth verification
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userID = request.auth.uid;

  // Enforce Pro Access
  if (!(await hasServiceOAuthConnectAccess(userID, SERVICE_NAME))) {
    logger.warn(`Blocking Suunto Token Set for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const { state, code, redirectUri } = request.data as SetAccessTokenRequest;

  if (!state || !code || !redirectUri) {
    logger.error('Missing state or code or redirectUri');
    throw new HttpsError('invalid-argument', 'Missing state, code, or redirectUri');
  }

  if (!await validateOAuth2State(userID, SERVICE_NAME, state)) {
    throw new HttpsError('permission-denied', 'Invalid OAuth state');
  }

  try {
    await getAndSetServiceOAuth2AccessTokenForUser(userID, SERVICE_NAME, redirectUri, code, state);
  } catch (e: any) {
    const failure = extractRefreshFailureDetails(e);
    const status = failure.statusCode || 500;
    if (isOAuthFlowContextMismatchError(e)) {
      throw new HttpsError('permission-denied', 'Invalid OAuth state');
    }
    if (status === 403) {
      throw new HttpsError('permission-denied', 'Suunto rejected the authorization request');
    }
    if (failure.isInvalidGrant && failure.statusCode === 400) {
      logger.warn('[SuuntoAuth] Authorization code exchange was rejected with a non-terminal invalid_grant.', {
        serviceName: SERVICE_NAME,
        phase: 'authorization_code_exchange',
        providerStatus: failure.statusCode,
        providerErrorCode: 'invalid_grant',
        terminal: false,
        outcome: 'restart_oauth',
      });
      throw new HttpsError(
        'failed-precondition',
        'Suunto authorization code expired or was already used. Start the connection again.',
      );
    }
    if (status === 502) {
      logger.warn('[SuuntoAuth] Authorization code exchange failed because Suunto is temporarily unavailable.', {
        serviceName: SERVICE_NAME,
        phase: 'authorization_code_exchange',
        providerStatus: status,
        terminal: false,
        outcome: 'retry_later',
      });
      throw new HttpsError('unavailable', 'Suunto service is temporarily unavailable');
    }
    logger.error('[SuuntoAuth] Authorization code exchange failed unexpectedly.', {
      serviceName: SERVICE_NAME,
      phase: 'authorization_code_exchange',
      providerStatus: failure.statusCode || undefined,
      errorName: typeof e?.name === 'string' ? e.name : 'Error',
    });
    throw new HttpsError('internal', 'Authorization code flow error');
  }
});


interface DeauthorizeResponse {
  result: string;
}

/**
 * Deauthorizes a Suunto app account upon user request
 */
export const deauthorizeSuuntoApp = onCall({
  region: FUNCTIONS_MANIFEST.deauthorizeSuuntoApp.region,
  secrets: FUNCTION_SECRET_BINDINGS.deauthorizeSuuntoApp,
  cors: ALLOWED_CORS_ORIGINS,
  memory: '512MiB',
  maxInstances: 10
}, async (request): Promise<DeauthorizeResponse> => {
  // App Check verification
  enforceAppCheck(request);

  // Auth verification
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userID = request.auth.uid;

  try {
    await disconnectServiceForUser(userID, SERVICE_NAME);
  } catch (e: unknown) {
    if (isServiceDisconnectInProgressError(e)) {
      logger.warn(`Suunto disconnect is waiting for another connection operation for user ${userID}.`);
      throw new HttpsError('unavailable', e.message, e.details);
    }
    logger.error(e);
    throw new HttpsError('internal', 'Deauthorization Error');
  }

  return { result: 'Deauthorized' };
});
