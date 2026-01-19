'use strict';

import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { isProUser, PRO_REQUIRED_MESSAGE } from '../../utils';
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

export const getSuuntoAPIAuthRequestTokenRedirectURI = functions
  .runWith({ memory: '256MB' })
  .region(FUNCTIONS_MANIFEST.getSuuntoAPIAuthRequestTokenRedirectURI.region)
  .https.onCall(async (data: GetAuthRedirectURIRequest, context): Promise<GetAuthRedirectURIResponse> => {
    // App Check verification
    if (!context.app) {
      throw new functions.https.HttpsError('failed-precondition', 'App Check verification failed.');
    }

    // Auth verification
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const userID = context.auth.uid;

    // Enforce Pro Access
    if (!(await isProUser(userID))) {
      logger.warn(`Blocking Suunto Auth for non-pro user ${userID}`);
      throw new functions.https.HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
    }

    const redirectURI = data.redirectUri;
    if (!redirectURI) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing redirect_uri');
    }

    return {
      redirect_uri: await getServiceOAuth2CodeRedirectAndSaveStateToUser(userID, SERVICE_NAME, redirectURI),
    };
  });


interface SetAccessTokenRequest {
  state: string;
  code: string;
  redirectUri: string;
}

export const requestAndSetSuuntoAPIAccessToken = functions
  .runWith({ memory: '256MB' })
  .region(FUNCTIONS_MANIFEST.requestAndSetSuuntoAPIAccessToken.region)
  .https.onCall(async (data: SetAccessTokenRequest, context): Promise<void> => {
    // App Check verification
    if (!context.app) {
      throw new functions.https.HttpsError('failed-precondition', 'App Check verification failed.');
    }

    // Auth verification
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const userID = context.auth.uid;

    // Enforce Pro Access
    if (!(await isProUser(userID))) {
      logger.warn(`Blocking Suunto Token Set for non-pro user ${userID}`);
      throw new functions.https.HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
    }

    const { state, code, redirectUri } = data;

    if (!state || !code || !redirectUri) {
      logger.error('Missing state or code or redirectUri');
      throw new functions.https.HttpsError('invalid-argument', 'Missing state, code, or redirectUri');
    }

    if (!await validateOAuth2State(userID, SERVICE_NAME, state)) {
      throw new functions.https.HttpsError('permission-denied', 'Invalid OAuth state');
    }

    try {
      await getAndSetServiceOAuth2AccessTokenForUser(userID, SERVICE_NAME, redirectUri, code);
    } catch (e: any) {
      logger.error(e);
      const status = e.statusCode || (e.output && e.output.statusCode) || 500;
      if (status === 502) {
        throw new functions.https.HttpsError('unavailable', 'Suunto service is temporarily unavailable');
      }
      throw new functions.https.HttpsError('internal', 'Authorization code flow error');
    }
  });


interface DeauthorizeResponse {
  result: string;
}

/**
 * Deauthorizes a Suunto app account upon user request
 */
export const deauthorizeSuuntoApp = functions
  .runWith({ memory: '256MB' })
  .region(FUNCTIONS_MANIFEST.deauthorizeSuuntoApp.region)
  .https.onCall(async (_data: unknown, context): Promise<DeauthorizeResponse> => {
    // App Check verification
    if (!context.app) {
      throw new functions.https.HttpsError('failed-precondition', 'App Check verification failed.');
    }

    // Auth verification
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const userID = context.auth.uid;

    try {
      await deauthorizeServiceForUser(userID, SERVICE_NAME);
    } catch (e: any) {
      logger.error(e);
      throw new functions.https.HttpsError('internal', 'Deauthorization Error');
    }

    return { result: 'Deauthorized' };
  });
