import * as functions from "firebase-functions";
import {create} from "simple-oauth2";

/**
 * Creates a configured simple-oauth2 client for Suunto app.
 */
export function suuntoApiAuth() {
  // Suunto app OAuth 2 setup
  const credentials = {
    client: {
      id: functions.config().suuntoapp.client_id,
      secret: functions.config().suuntoapp.client_secret,
    },
    auth: {
      tokenHost: 'https://cloudapi-oauth.suunto.com/',
      // tokenPath: '/oauth/token',
    },
  };
  return create(credentials);
}
