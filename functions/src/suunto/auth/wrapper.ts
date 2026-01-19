'use strict';

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { isProUser, PRO_REQUIRED_MESSAGE, enforceAppCheck } from '../../utils';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  deauthorizeServiceForUser,
  getAndSetServiceOAuth2AccessTokenForUser,
  getServiceOAuth2CodeRedirectAndSaveStateToUser,
  validateOAuth2State,
} from '../../OAuth2';
import { FUNCTIONS_MANIFEST } from '../../../../src/shared/functions-manifest';

const SERVICE_NAME = ServiceNames.SuuntoApp;


interface GetAuthRedirectURIRequest {
  redirectUri: string;
}

interface GetAuthRedirectURIResponse {
  redirect_uri: string;
}

export const getSuuntoAPIAuthRequestTokenRedirectURI = onCall({
  region: FUNCTIONS_MANIFEST.getSuuntoAPIAuthRequestTokenRedirectURI.region,
  cors: true,
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
  if (!(await isProUser(userID))) {
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
  cors: true,
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
  if (!(await isProUser(userID))) {
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
    await getAndSetServiceOAuth2AccessTokenForUser(userID, SERVICE_NAME, redirectUri, code);
  } catch (e: any) {
    logger.error(e);
    const status = e.statusCode || (e.output && e.output.statusCode) || 500;
    if (status === 502) {
      throw new HttpsError('unavailable', 'Suunto service is temporarily unavailable');
    }
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
  cors: true,
  memory: '256MiB',
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
    await deauthorizeServiceForUser(userID, SERVICE_NAME);
  } catch (e: any) {
    logger.error(e);
    throw new HttpsError('internal', 'Deauthorization Error');
  }

  return { result: 'Deauthorized' };
});
