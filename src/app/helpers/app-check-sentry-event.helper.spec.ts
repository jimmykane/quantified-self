import { describe, expect, it, vi } from 'vitest';
import { BrowserClient, Scope, defaultStackParser } from '@sentry/browser';
import type { Envelope, ErrorEvent, EventHint } from '@sentry/browser';
import { appCheckBeforeSend } from './app-check-sentry-event.helper';
import { appCheckBeforeSend as lazyBeforeSend } from './app-check-sentry-filter.helper';

function diagnostic(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return { type: undefined, message: 'App Check verification outcome', level: 'info',
    contexts: { appCheck: { code: 'appCheck/recaptcha-error', authState: 'signed-in', authStateAtFailure: 'signed-in',
      outcome: 'operation-succeeded', operation: 'profile-load', elapsedMs: 2000, failureNotifications: 2 } }, ...overrides };
}

describe('appCheckBeforeSend', () => {
  it('retains identity, page paths, browser agent and useful breadcrumbs while dropping arbitrary payloads', () => {
    const event = diagnostic({
      user: { id: 'account-fixture', email: 'fixture@example.invalid', ip_address: 'secret-ip', privateData: 'secret-user-data' },
      request: { url: 'https://secret-login:secret-password@quantified-self.io/user/account-fixture/event/event-fixture?token=secret-query#secret-fragment',
        method: 'GET', data: 'secret-body', cookies: { session: 'secret-cookie' }, query_string: 'secret-query',
        headers: { Authorization: 'Bearer secret-bearer', Cookie: 'secret-cookie', 'User-Agent': 'TestBrowser/1.0',
          Referer: 'https://quantified-self.io/dashboard?code=secret-code#secret-fragment' } },
      extra: { workout: 'secret-workout' },
      contexts: { ...diagnostic().contexts, workout: { name: 'secret-workout' },
        trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), data: { token: 'secret-trace-data' } } },
      tags: { privateTag: 'secret-tag' }, fingerprint: ['secret-fingerprint'],
      logentry: { message: 'secret-logentry' }, exception: { values: [{ value: 'secret-exception' }] },
      transaction: 'secret-transaction',
      breadcrumbs: [
        { category: 'navigation', timestamp: 1, data: { from: '/dashboard?token=secret-query', to: '/event/event-fixture#secret-fragment', payload: 'secret-navigation' } },
        { category: 'fetch', timestamp: 2, data: { url: 'https://api.example.invalid/callable?key=secret-key', method: 'POST', status_code: 403, body: 'secret-request', headers: 'secret-headers' } },
        { category: 'console', level: 'warning', timestamp: 3, message: 'secret-console', data: { arguments: ['secret-arguments'] } },
        { category: 'ui.click', timestamp: 4, message: 'secret-selector', data: { text: 'secret-workout-name' } },
        { category: 'custom', message: 'secret-custom' },
      ],
    });
    const before = JSON.stringify(event);
    const clean = appCheckBeforeSend(event)!;
    expect(clean.user).toEqual({ id: 'account-fixture', email: 'fixture@example.invalid' });
    expect(clean.request).toEqual({ url: 'https://quantified-self.io/user/account-fixture/event/event-fixture', method: 'GET',
      headers: { 'User-Agent': 'TestBrowser/1.0', Referer: 'https://quantified-self.io/dashboard' } });
    expect(clean.contexts?.trace).toEqual({ trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) });
    expect(clean.breadcrumbs).toMatchObject([
      { category: 'navigation', data: { from: '/dashboard', to: '/event/event-fixture' } },
      { category: 'fetch', data: { url: 'https://api.example.invalid/callable', method: 'POST', status_code: 403 } },
      { category: 'console', level: 'warning', timestamp: 3 }, { category: 'ui.click', timestamp: 4 },
    ]);
    expect(JSON.stringify(clean)).not.toContain('secret-');
    expect(JSON.stringify(event)).toBe(before);
  });

  it('keeps only bounded diagnostic values and reconstructs fingerprints from validated labels', () => {
    const clean = appCheckBeforeSend(diagnostic({ contexts: { appCheck: {
      code: 'appCheck/secret-code', authState: 'secret-state', operation: 'secret-operation', outcome: 'secret-outcome',
      elapsedMs: Infinity, failureNotifications: -2, retryAfterSeconds: 999999, httpStatus: 200, token: 'secret-token',
    } } }))!;
    expect(clean.contexts?.['appCheck']).toMatchObject({ code: 'appCheck/unknown', httpStatus: null, retryAfterSeconds: null });
    expect(clean.contexts?.['appCheck']?.['elapsedMs']).toBeUndefined();
    expect(clean.contexts?.['appCheck']?.['failureNotifications']).toBeUndefined();
    expect(clean.fingerprint).toEqual(['app-check-outcome', 'unknown', 'verification', 'appCheck/unknown']);
    expect(JSON.stringify(clean)).not.toContain('secret-');
  });

  it('preserves absent hints separately from an explicitly unknown first-token comparison', () => {
    const clean = appCheckBeforeSend(diagnostic())!;
    expect(clean.contexts?.['appCheck']?.['online']).toBeUndefined();
    expect(clean.contexts?.['appCheck']?.['tokenChanged']).toBeUndefined();
    const firstToken = diagnostic({ contexts: { appCheck: {
      code: 'appCheck/recaptcha-error', outcome: 'token-available', tokenChanged: null,
    } } });
    expect(appCheckBeforeSend(firstToken)?.contexts?.['appCheck']?.['tokenChanged']).toBeNull();
  });

  it.each(['javascript:secret-script', 'data:secret-data', 'https://[invalid', 'not-a-url', 'https://example.invalid/' + 'x'.repeat(4096)])('discards unsupported or malformed URL %s', url => {
    const clean = appCheckBeforeSend(diagnostic({ request: { url }, breadcrumbs: [{ category: 'fetch', data: { url } }] }))!;
    expect(clean.request?.url).toBeUndefined();
    expect(clean.breadcrumbs?.[0].data?.['url']).toBeUndefined();
  });

  it('retains existing failure grouping and safe retry evidence', () => {
    const event = diagnostic({ message: 'App Check verification failed', level: 'warning',
      tags: { appCheckPhase: 'initial-rejection' }, contexts: { appCheck: {
        code: 'appCheck/initial-throttle', httpStatus: 403, retryAfterSeconds: 86400, cooldown: true,
        source: 'console-breadcrumb', authState: 'restoring', visibility: 'visible', online: true,
      } } });
    const clean = appCheckBeforeSend(event)!;
    expect(clean.fingerprint).toEqual(['app-check-verification', 'initial-rejection', '403']);
    expect(clean.contexts?.['appCheck']).toMatchObject({ code: 'appCheck/initial-throttle', httpStatus: 403,
      retryAfterSeconds: 86400, cooldown: true, source: 'console-breadcrumb', authState: 'restoring', online: true });
  });

  it('leaves unrelated events and attachments unchanged', () => {
    const event: ErrorEvent = { type: undefined, message: 'Other error', extra: { existing: 'untouched' } };
    const hint: EventHint = { attachments: [{ filename: 'fixture.txt', data: 'existing' }] };
    expect(appCheckBeforeSend(event, hint)).toBe(event);
    expect(hint.attachments).toHaveLength(1);
  });

  it('drops malformed diagnostics if a context cannot be inspected', () => {
    const event = diagnostic();
    Object.defineProperty(event, 'contexts', { get: () => { throw new Error('malformed'); } });
    expect(appCheckBeforeSend(event)).toBeNull();
  });

  it.each(['App Check verification failed', 'App Check verification outcome'])('scrubs the final SDK envelope for %s without changing the shared scope', async message => {
    const envelopes: Envelope[] = [];
    // A private client/scope and in-memory transport exercise SDK enrichment and attachment handling.
    // No global SDK binding, browser globals, credentials or network requests are needed.
    const client = new BrowserClient({ dsn: 'https://public@example.invalid/1', integrations: [],
      stackParser: defaultStackParser, sendClientReports: false, beforeSend: lazyBeforeSend,
      transport: () => ({ send: async envelope => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) });
    const scope = new Scope();
    scope.setClient(client);
    scope.setUser({ id: 'account-fixture', email: 'fixture@example.invalid' });
    scope.setContext('appCheck', diagnostic().contexts?.['appCheck'] ?? {});
    scope.setExtra('workout', 'secret-workout');
    scope.setContext('workout', { name: 'secret-workout-name' });
    scope.addBreadcrumb({ category: 'navigation', data: { from: '/dashboard?token=secret-token', to: '/event/event-fixture' } });
    scope.addBreadcrumb({ category: 'console', message: 'secret-console', data: { arguments: ['secret-token'] } });
    scope.addAttachment({ filename: 'private.fit', data: 'secret-file' });
    scope.addEventProcessor(event => ({ ...event, request: {
      url: 'https://quantified-self.io/event/event-fixture?token=secret-token', data: 'secret-body',
    } }));
    client.init();
    try {
      scope.captureMessage(message, message === 'App Check verification failed' ? 'warning' : 'info');
      await client.flush(1000);
      expect(envelopes).toHaveLength(1);
      const items = envelopes[0][1];
      expect(items.map(item => item[0].type)).toEqual(['event']);
      const outgoing = items[0][1] as ErrorEvent;
      expect(outgoing.user).toEqual({ id: 'account-fixture', email: 'fixture@example.invalid' });
      expect(outgoing.request?.url).toBe('https://quantified-self.io/event/event-fixture');
      expect(outgoing.breadcrumbs?.[0].data).toEqual({ from: '/dashboard', to: '/event/event-fixture' });
      expect(outgoing.contexts?.['appCheck']?.['code']).toBe('appCheck/recaptcha-error');
      expect(JSON.stringify(envelopes)).not.toContain('secret-');
      expect(scope.getUser()).toEqual({ id: 'account-fixture', email: 'fixture@example.invalid' });
      expect(scope.getScopeData().extra['workout']).toBe('secret-workout');
      expect(scope.getScopeData().breadcrumbs[0].data?.['from']).toBe('/dashboard?token=secret-token');
      expect(scope.getScopeData().attachments).toHaveLength(1);

      scope.captureEvent({ message: 'Unrelated error' });
      await client.flush(1000);
      expect(envelopes).toHaveLength(2);
      expect(envelopes[1][1].map(item => item[0].type)).toEqual(['event', 'attachment']);
      const unrelated = envelopes[1][1][0][1] as ErrorEvent;
      expect(unrelated.extra?.['workout']).toBe('secret-workout');
      expect(unrelated.breadcrumbs?.[0].data?.['from']).toBe('/dashboard?token=secret-token');
    } finally { await client.close(1000); }
  });

  it('drops a diagnostic if the lazy scrubber cannot load while leaving unrelated errors untouched', async () => {
    vi.doMock('./app-check-sentry-event.helper', () => { throw new Error('chunk unavailable'); });
    try {
      await expect(lazyBeforeSend(diagnostic())).resolves.toBeNull();
      const other: ErrorEvent = { type: undefined, message: 'Unrelated error' };
      expect(lazyBeforeSend(other)).toBe(other);
    } finally { vi.doUnmock('./app-check-sentry-event.helper'); }
  });
});
