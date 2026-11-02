import { describe, expect, it } from 'vitest';
import { BrowserClient, Scope, defaultStackParser } from '@sentry/browser';
import type { Envelope, ErrorEvent, TransactionEvent } from '@sentry/browser';
import { appCheckBeforeBreadcrumb } from './app-check-console-diagnostics.helper';
import { appCheckBeforeSend } from './app-check-sentry-filter.helper';
import { scrubSentryOAuthEvent, scrubSentryOAuthUrl } from './sentry-oauth-url.helper';

const callback = '/services?serviceName=Suunto&code=secret-code&state=secret-state#_=_';
const redacted = '/services?serviceName=Suunto&code=[Filtered]&state=[Filtered]#_=_';

describe('Sentry OAuth URL scrubbing', () => {
  it.each([
    [callback, redacted],
    [`https://example.invalid${callback}`, `https://example.invalid${redacted}`],
    ['?code=secret-code&state=secret-state&view=history', '?code=[Filtered]&state=[Filtered]&view=history'],
    ['code=secret-code&state=secret-state', 'code=[Filtered]&state=[Filtered]'],
    ['#code=secret-code&state=secret-state', '#code=[Filtered]&state=[Filtered]'],
    ['#/services?code=secret-code&state=secret-state', '#/services?code=[Filtered]&state=[Filtered]'],
    ['?%63ode=secret-code&STATE=secret-state&code=secret-copy', '?%63ode=[Filtered]&STATE=[Filtered]&code=[Filtered]'],
    ['?view=history&code=&state=secret%26state', '?view=history&code=[Filtered]&state=[Filtered]'],
    ['?%invalid=retained&state=secret-state', '?%invalid=retained&state=[Filtered]'],
    [`/login?returnUrl=${encodeURIComponent(callback)}`, `/login?returnUrl=${encodeURIComponent(redacted)}`],
    ['/login?returnUrl=%2Fdashboard%3Fmetric%3Dsleep', '/login?returnUrl=%2Fdashboard%3Fmetric%3Dsleep'],
    ['/dashboard?metric=sleep&stateName=retained#chart', '/dashboard?metric=sleep&stateName=retained#chart'],
  ])('redacts only OAuth values in %s', (url, expected) => {
    expect(scrubSentryOAuthUrl(url)).toBe(expected);
    expect(scrubSentryOAuthUrl(expected)).toBe(expected);
  });

  it('scrubs navigation and HTTP breadcrumbs without mutating the original callback', () => {
    const breadcrumb = { category: 'navigation', data: { from: callback, to: callback, retained: 'yes' } };
    expect(appCheckBeforeBreadcrumb(breadcrumb)).toEqual({ category: 'navigation',
      data: { from: redacted, to: redacted, retained: 'yes' } });
    expect(breadcrumb.data.from).toBe(callback);
    expect(appCheckBeforeBreadcrumb({ category: 'fetch', data: { url: callback, status_code: 400 } }).data)
      .toEqual({ url: redacted, status_code: 400 });
  });

  it.each([
    'code=secret-code&state=secret-state&metric=sleep',
    { code: 'secret-code', state: 'secret-state', metric: 'sleep' },
    { returnUrl: callback, metric: 'sleep' },
    { returnUrl: encodeURIComponent(callback), metric: 'sleep' },
    [['code', 'secret-code'], ['state', 'secret-state'], ['metric', 'sleep']] as Array<[string, string]>,
  ])('scrubs supported request query representations', query => {
    const event: ErrorEvent = { type: undefined, request: { query_string: query } };
    const clean = scrubSentryOAuthEvent(event);
    expect(JSON.stringify(clean)).not.toContain('secret-');
    expect(JSON.stringify(clean)).toContain('sleep');
    expect(JSON.stringify(event)).toContain('secret-code');
  });

  it.each([[undefined, 'error'], ['transaction', 'error'], [undefined, 'warning']] as const)(
    'scrubs outgoing %s / %s envelopes while preserving error and application context', async (type, level) => {
    const envelopes: Envelope[] = [];
    const client = new BrowserClient({ dsn: 'https://public@example.invalid/1', integrations: [],
      stackParser: defaultStackParser, sendClientReports: false,
      beforeSend: appCheckBeforeSend, beforeSendTransaction: scrubSentryOAuthEvent,
      transport: () => ({ send: async envelope => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) });
    const scope = new Scope(); scope.setClient(client);
    scope.addBreadcrumb({ category: 'navigation', data: { from: callback, to: '/services' } });
    const event: ErrorEvent | TransactionEvent = {
      type, platform: 'javascript', message: 'Existing error', level, transaction: callback,
      request: { url: callback, query_string: 'code=secret-code&state=secret-state', headers: { ReFeReR: callback, 'User-Agent': 'test' } },
      tags: { url: callback, retained: 'yes' }, extra: { state: 'application-state', code: 'application-code' },
      contexts: { trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), data: { 'url.full': callback, 'http.query': 'code=secret-code' } } },
      exception: { values: [{ type: 'Error', value: 'Existing error', stacktrace: { frames: [{ filename: callback, abs_path: callback, function: 'retained' }] } }] },
      spans: [{ trace_id: 'a'.repeat(32), span_id: 'c'.repeat(16), start_timestamp: 1, timestamp: 2,
        description: callback, data: { 'http.url': callback, 'http.fragment': 'state=secret-state', retained: true } }],
      ...(type === 'transaction' ? { start_timestamp: 1, timestamp: 2 } : {}),
    };
    const original = JSON.stringify(event);
    client.init();
    try {
      scope.captureEvent(event);
      await client.flush(1000);
      expect(envelopes).toHaveLength(1);
      expect(JSON.stringify(envelopes)).not.toContain('secret-');
      const outgoing = envelopes[0][1][0][1] as ErrorEvent | TransactionEvent;
      expect(outgoing.request?.url).toBe(redacted);
      expect(outgoing.request?.headers?.['User-Agent']).toBe('test');
      expect(outgoing.breadcrumbs?.[0].data?.['from']).toBe(redacted);
      expect(outgoing.extra).toEqual({ state: 'application-state', code: 'application-code' });
      expect(outgoing.level).toBe(level);
      expect(outgoing.exception?.values?.[0].value).toBe('Existing error');
      expect(scope.getScopeData().breadcrumbs[0].data?.['from']).toBe(callback);
      expect(JSON.stringify(event)).toBe(original);
    } finally { await client.close(1000); }
  });
});
