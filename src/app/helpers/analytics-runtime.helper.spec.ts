import { describe, expect, it, vi } from 'vitest';
import { analyticsEventParameters, initializeProductionAnalytics } from './analytics-runtime.helper';

const production = {
  production: true, beta: false, localhost: false, appVersion: 'test',
  firebase: { projectId: 'quantified-self-io' },
};
const page = { isBrowser: true, href: 'https://quantified-self.io/', referrer: 'https://www.google.com/' };

describe('analytics runtime boundary', () => {
  it('initializes the production SDK with no campaign or referrer override for a real acquisition entry', () => {
    const analytics = {};
    const initialize = vi.fn().mockReturnValue(analytics);
    expect(initializeProductionAnalytics(production, page, initialize)).toBe(analytics);
    expect(initialize).toHaveBeenCalledExactlyOnceWith({ config: {
      app_name: 'quantified-self-io', app_version: 'test', debug_mode: false,
    } });
  });

  it.each([
    { ...production, production: false },
    { ...production, beta: true },
    { ...production, localhost: true },
    { ...production, production: false, forceAnalyticsCollection: true },
  ])('never initializes Analytics for a non-production build: %j', environment => {
    const initialize = vi.fn();
    expect(initializeProductionAnalytics(environment, page, initialize)).toBeNull();
    expect(initialize).not.toHaveBeenCalled();
  });

  it.each([
    'http://localhost:4200/', 'https://localhost:4200/', 'http://127.0.0.1:4210/',
    'http://192.168.1.2:4200/', 'http://[::1]:4200/', 'https://beta.quantified-self.io/',
    'https://quantified-self-io.web.app/', 'https://quantified-self-io.firebaseapp.com/',
    'https://quantified-self.io.evil.test/', 'https://prerender-worker.local/',
    'http://quantified-self.io/', 'https://quantified-self.io:4200/', '', 'invalid',
  ])('does not let a production bundle send from a different origin: %s', href => {
    const initialize = vi.fn();
    expect(initializeProductionAnalytics(production, { ...page, href }, initialize)).toBeNull();
    expect(initialize).not.toHaveBeenCalled();
  });

  it('does not initialize Analytics during server rendering', () => {
    const initialize = vi.fn();
    expect(initializeProductionAnalytics(production, { ...page, isBrowser: false }, initialize)).toBeNull();
    expect(initialize).not.toHaveBeenCalled();
  });

  it.each([
    ['/payment/success', 'https://checkout.stripe.com/c/pay/test'],
    ['/payment/cancel/', 'https://billing.stripe.com/p/session/test'],
    ['/login?returnUrl=%2Fdashboard', 'https://quantified-self-io.firebaseapp.com/__/auth/handler'],
    ['/services?serviceName=Garmin%20API&connect=1', 'https://connect.garmin.com/oauthConfirm'],
    ['/services?serviceName=Suunto%20app&connect=1', 'https://cloudapi-oauth.suunto.com/oauth/authorize'],
    ['/services?serviceName=COROS%20API&connect=1', 'https://open.coros.com/oauth2/authorize'],
    ['/services?serviceName=Wahoo%20API&connect=1', 'https://api.wahooligan.com/oauth/authorize'],
  ])('ignores a known flow referrer only on its return: %s', (path, referrer) => {
    const initialize = vi.fn();
    initializeProductionAnalytics(production, { ...page, href: `https://quantified-self.io${path}`, referrer }, initialize);
    expect(initialize.mock.calls[0][0].config.ignore_referrer).toBe(true);
  });

  it.each([
    ['/guides/sync-garmin-to-suunto?utm_source=partner&utm_medium=referral', 'https://connect.garmin.com/modern/activity/example'],
    ['/services?serviceName=Garmin%20API', 'https://connect.garmin.com/'],
    ['/services?serviceName=Garmin%20API&connect=1', 'https://connect.garmin.com.evil.test/'],
    ['/services?serviceName=Garmin%20API&connect=1', 'https://open.coros.com/'],
    ['/services?serviceName=Other&connect=1', 'https://open.coros.com/'],
    ['/login', 'https://reddit.com/r/example'],
    ['/login', 'https://different-project.firebaseapp.com/__/auth/handler'],
    ['/payment/success', 'https://www.google.com/'],
    ['/payment/success', 'https://checkout.stripe.com.evil.test/'],
    ['/payment/success', 'not a URL'],
    ['/payment/success', ''],
  ])('preserves unrelated referrals and campaign URLs: %s %s', (path, referrer) => {
    const initialize = vi.fn();
    const context = { ...page, href: `https://quantified-self.io${path}`, referrer };
    const original = { ...context };
    initializeProductionAnalytics(production, context, initialize);
    expect(initialize.mock.calls[0][0].config).not.toHaveProperty('ignore_referrer');
    expect(context).toEqual(original);
  });
});

describe('internal analytics context', () => {
  it.each(['side_nav', 'history_import', 'connection_card', 'event_table_selection'])('keeps %s out of the campaign source field without changing caller data', source => {
    const params = { source, method: 'example' };
    expect(analyticsEventParameters(params)).toEqual({ interaction_source: source, method: 'example' });
    expect(params).toEqual({ source, method: 'example' });
  });

  it('preserves an explicit interaction source and removes an obsolete source alias', () => {
    expect(analyticsEventParameters({ source: 'old', interaction_source: 'current' })).toEqual({ interaction_source: 'current' });
  });

  it('leaves unrelated event parameters unchanged', () => {
    const params = { source_service: 'Garmin API', currency: 'EUR', value: 5 };
    expect(analyticsEventParameters(params)).toBe(params);
    expect(analyticsEventParameters()).toBeUndefined();
    expect(analyticsEventParameters({ source: undefined })).toEqual({});
  });
});
