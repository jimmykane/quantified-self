import * as functions from "firebase-functions";
import { AuthorizationCode } from "simple-oauth2";

const STAGING_URL = 'https://opentest.coros.com';
const PRODUCTION_URL = 'https://open.coros.com';

/**
 * Creates a configured simple-oauth2 client for COROS API
 */
export function COROSAPIAuth(useStaging?: boolean): AuthorizationCode {
  // COROS API OAuth 2 setup
  return new AuthorizationCode({
    client: {
      id: functions.config().corosapi.client_id,
      secret: functions.config().corosapi.client_secret,
    },
    auth: {
      tokenHost: useStaging ? STAGING_URL : PRODUCTION_URL,
      // tokenPath: '/oauth2/token',
      authorizePath: '/oauth2/authorize',
      tokenPath: `/oauth2/accesstoken?client_id=${functions.config().corosapi.client_id}&client_secret=${functions.config().corosapi.client_secret}&grant_type=authorization_code`
    },
    options: {
      // authorizationMethod: 'body',
    },
  });
}
