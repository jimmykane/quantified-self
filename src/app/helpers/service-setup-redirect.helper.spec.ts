import { describe, expect, it } from 'vitest';
import { serviceSetupFromReturnUrl, WAHOO_SETUP_QUERY_PARAMS } from './service-setup-redirect.helper';

describe('service setup redirects', () => {
  it('retains the existing plain Connections destination', () => {
    expect(serviceSetupFromReturnUrl('/services')).toEqual({ returnUrl: '/services', serviceName: null });
  });

  it.each([
    { service: 'Wahoo%20API', serviceName: WAHOO_SETUP_QUERY_PARAMS.serviceName },
    { service: 'Wahoo+API', serviceName: WAHOO_SETUP_QUERY_PARAMS.serviceName },
    { service: 'COROS%20API', serviceName: 'COROS API' },
    { service: 'COROS+API', serviceName: 'COROS API' },
  ])('normalizes the curated setup destination: $service', ({ service, serviceName }) => {
    expect(serviceSetupFromReturnUrl(`/services?serviceName=${service}`)).toEqual({
      returnUrl: `/services?serviceName=${encodeURIComponent(serviceName)}`, serviceName,
    });
  });

  it.each([
    null, '', '/services?', '/services?serviceName=unknown',
    '/services?serviceName=COROS%20API&serviceName=COROS%20API',
    '/services?serviceName=COROS%20API&connect=true',
    '/services?serviceName=COROS%20API#connect',
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
