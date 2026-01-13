import { AuthorizationCode } from 'simple-oauth2';
import { config } from '../../config';

// Specifics from Garmin Documentation
const AUTH_HOST = 'https://connect.garmin.com';
const TOKEN_HOST = 'https://diauth.garmin.com';
const AUTH_PATH = '/oauth2Confirm';
const TOKEN_PATH = '/di-oauth2-service/oauth/token';

/**
 * Creates a configured simple-oauth2 client for Garmin Health API.
 */
export function GarminHealthAPIAuth(refresh = false): AuthorizationCode {
  return new AuthorizationCode({
    client: {
      id: config.garminhealthapi.client_id,
      secret: config.garminhealthapi.client_secret,
    },
    auth: {
      tokenHost: TOKEN_HOST,
      authorizeHost: AUTH_HOST,
      authorizePath: AUTH_PATH,
      tokenPath: TOKEN_PATH,
    },
    options: {
      authorizationMethod: 'body',
    },
  });
}
