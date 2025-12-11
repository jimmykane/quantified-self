import * as functions from 'firebase-functions/v1';
import * as crypto from 'crypto';
// import OAuth as OAuth from 'oauth-1.0a';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OAuth = require('oauth-1.0a');
/**
 * Creates a configured OAuth 1.0a for Garmin Health API.
 */
export function GarminHealthAPIAuth() {
  return OAuth({
    consumer: {
      key: functions.config().garminhealthapi.consumer_key,
      secret: functions.config().garminhealthapi.consumer_secret,
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
