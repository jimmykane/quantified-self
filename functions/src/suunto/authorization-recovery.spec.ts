import { describe, expect, it } from 'vitest';
import { isSuuntoOAuthRejection, isSuuntoSubscriptionKeyRejection } from './authorization-recovery';

describe('Suunto resource authorization recovery classification', () => {
  it.each([401, 403])('recovers HTTP %s but not an application-key rejection', statusCode => {
    expect(isSuuntoOAuthRejection({ statusCode })).toBe(true);
    const body = { statusCode, message: 'Access denied due to invalid subscription key.' };
    expect(isSuuntoOAuthRejection({ statusCode, error: body })).toBe(false);
    expect(isSuuntoOAuthRejection({ statusCode, error: JSON.stringify(body) })).toBe(false);
    expect(isSuuntoSubscriptionKeyRejection(statusCode, null, 'AzureApiManagementKey realm="private"')).toBe(true);
  });
  it('preserves only the existing invalid_grant exception and ignores unrelated statuses', () => {
    expect(isSuuntoOAuthRejection({ error: { error: 'invalid_grant' } })).toBe(true);
    for (const statusCode of [400, 404, 429, 500, undefined, '403']) {
      expect(isSuuntoOAuthRejection({ statusCode })).toBe(false);
    }
    expect(isSuuntoOAuthRejection(null)).toBe(false);
    expect(isSuuntoOAuthRejection({ statusCode: 403, providerCode: 'subscription_key_rejected' })).toBe(false);
  });
  it('does not guess from arbitrary, malformed or oversized provider text', () => {
    for (const body of ['private', '{', 'x'.repeat(8193), { message: 'Private permission error' }]) {
      expect(isSuuntoSubscriptionKeyRejection(403, body)).toBe(false);
    }
  });
});
