import { describe, expect, it } from 'vitest';
import { serviceSetupFromReturnUrl, WAHOO_SETUP_QUERY_PARAMS } from './service-setup-redirect.helper';

describe('service setup redirects', () => {
  it('retains the existing plain Connections destination', () => {
    expect(serviceSetupFromReturnUrl('/services')).toEqual({ returnUrl: '/services', serviceName: null });
  });

  it('retains sync setup as display-only navigation', () => {
    expect(serviceSetupFromReturnUrl('/services?setup=sync')).toEqual({returnUrl:'/services?setup=sync', serviceName:null, setup:'sync'});
  });

  it.each(['Garmin API', 'Suunto app', 'COROS API', 'Wahoo API'])('retains the %s sync tab without provider actions', serviceName => {
    expect(serviceSetupFromReturnUrl(`/services?setup=sync&serviceName=${encodeURIComponent(serviceName)}`)).toEqual({
      returnUrl:`/services?serviceName=${encodeURIComponent(serviceName)}&setup=sync`, serviceName, setup:'sync',
    });
  });

  it.each([
    { service: 'Wahoo%20API', serviceName: WAHOO_SETUP_QUERY_PARAMS.serviceName },
    { service: 'Wahoo+API', serviceName: WAHOO_SETUP_QUERY_PARAMS.serviceName },
    { service: 'COROS%20API', serviceName: 'COROS API' },
    { service: 'COROS+API', serviceName: 'COROS API' },
    { service: 'Suunto%20app', serviceName: 'Suunto app' },
    { service: 'Suunto+app', serviceName: 'Suunto app' },
  ])('normalizes the curated setup destination: $service', ({ service, serviceName }) => {
    expect(serviceSetupFromReturnUrl(`/services?serviceName=${service}`)).toEqual({
      returnUrl: `/services?serviceName=${encodeURIComponent(serviceName)}`, serviceName,
    });
  });

  it.each([
    '/services?setup=sync&connect=true', '/services?setup=sync&setup=sync', '/services?setup=other',
    '/services?setup=sync&serviceName=unknown', '/services?setup=sync&serviceName=',
    '/services?setup=sync&serviceName=Garmin%20API&serviceName=Garmin%20API',
    null, '', '/services?', '/services?serviceName=unknown',
    '/services?serviceName=Suunto%20app&connect=true',
    '/services?serviceName=Suunto%20app&serviceName=Suunto%20app',
    '/services?serviceName=Suunto%20app#connect',
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
