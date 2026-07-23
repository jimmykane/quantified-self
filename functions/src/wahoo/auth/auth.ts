import { AuthorizationCode } from 'simple-oauth2';
import { config } from '../../config';
import { WAHOO_API_BASE_URL } from '../constants';

export function WahooAPIAuth(): AuthorizationCode {
  return new AuthorizationCode({
    client: {
      id: config.wahooapi.client_id,
      secret: config.wahooapi.client_secret,
    },
    auth: {
      tokenHost: WAHOO_API_BASE_URL,
      authorizePath: '/oauth/authorize',
      tokenPath: '/oauth/token',
    },
    options: {
      authorizationMethod: 'body',
    },
  });
}
