import { AuthorizationCode } from 'simple-oauth2';
import { config } from '../../config';

/**
 * Creates a configured simple-oauth2 client for Suunto app.
 */
export function SuuntoAPIAuth(): AuthorizationCode {
  // Suunto app OAuth 2 setup
  const credentials = {
    client: {
      id: config.suuntoapp.client_id,
      secret: config.suuntoapp.client_secret,
    },
    auth: {
      tokenHost: 'https://cloudapi-oauth.suunto.com/',
      // tokenPath: '/oauth/token',
    },
  };
  return new AuthorizationCode(credentials);
}
