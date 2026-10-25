import { describe, expect, it } from 'vitest';
import { serviceSetupFromReturnUrl, WAHOO_SETUP_QUERY_PARAMS } from './service-setup-redirect.helper';

describe('service setup redirects', () => {
  it('retains the existing plain Connections destination', () => {
    expect(serviceSetupFromReturnUrl('/services')).toEqual({ returnUrl: '/services', serviceName: null });
  });

  it.each(['Wahoo%20API', 'Wahoo+API'])('normalizes the curated Wahoo destination: %s', service => {
    expect(serviceSetupFromReturnUrl(`/services?serviceName=${service}`)).toEqual({
      returnUrl: '/services?serviceName=Wahoo%20API', serviceName: WAHOO_SETUP_QUERY_PARAMS.serviceName,
    });
  });

  it.each([
    null, '', '/services?', '/services?serviceName=unknown',
    '/services?serviceName=Wahoo%20API&serviceName=Garmin%20API',
    '/services?serviceName=Wahoo%20API&returnUrl=https://other.test',
    '/services?serviceName=Wahoo%20API#connect',
    'https://other.test/services?serviceName=Wahoo%20API',
    '//other.test/services?serviceName=Wahoo%20API',
    '/services/../other?serviceName=Wahoo%20API',
    '/services\\other?serviceName=Wahoo%20API',
  ])('rejects unapproved destinations and extra actions: %s', value => {
    expect(serviceSetupFromReturnUrl(value)).toBeNull();
  });
});
