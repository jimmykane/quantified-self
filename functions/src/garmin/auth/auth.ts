import * as crypto from 'crypto';
// import OAuth as OAuth from 'oauth-1.0a';

import OAuth from 'oauth-1.0a';
import { config } from '../../config';
/**
 * Creates a configured OAuth 1.0a for Garmin Health API.
 */
export function GarminHealthAPIAuth() {
  return new OAuth({
    consumer: {
      key: config.garminhealthapi.consumer_key,
      secret: config.garminhealthapi.consumer_secret,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(base_string: string, key: string): any {
      return crypto
        .createHmac('sha1', key)
        .update(base_string)
        .digest('base64');
    },
  });
}
