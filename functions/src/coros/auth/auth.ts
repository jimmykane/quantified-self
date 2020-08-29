import * as functions from "firebase-functions";
import { AuthorizationCode } from "simple-oauth2";

const STAGING_URL = 'https://opentest.coros.com';
const PRODUCTION_URL = 'https://open.coros.com';
const USE_STAGING = true;

/**
 * Creates a configured simple-oauth2 client for COROS API
 */
export function COROSAPIAuth(): AuthorizationCode {
  // COROS API OAuth 2 setup
  return new AuthorizationCode({
    client: {
      id: functions.config().corosapi.client_id,
      secret: functions.config().corosapi.client_secret,
    },
    auth: {
      tokenHost: USE_STAGING ? STAGING_URL : PRODUCTION_URL,
      // tokenPath: '/oauth2/token',
      authorizePath: '/oauth2/authorize',
      tokenPath: `/oauth2/accesstoken`
    },
    options: {
      // authorizationMethod: 'body',
    },
  });
}
