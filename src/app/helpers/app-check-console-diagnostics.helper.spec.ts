import { afterEach, describe, expect, it, vi } from 'vitest';
import { appCheckBeforeBreadcrumb, observeInitialAppCheckRejections } from './app-check-console-diagnostics.helper';

const prefix = '[2026-10-20T10:00:00.000Z]  @firebase/app-check:';
const warning = 'AppCheck: 403 error. Attempts allowed again after 01d:00m:00s (appCheck/initial-throttle).';
const unsubscribe: Array<() => void> = [];
afterEach(() => { unsubscribe.splice(0).forEach(stop => stop()); });

describe('App Check console diagnostics', () => {
  it('reports only sanitized rejection fields while preserving the original breadcrumb', () => {
    const observer = vi.fn();
    unsubscribe.push(observeInitialAppCheckRejections(observer));
    const breadcrumb = { category: 'console', level: 'warning', data: { arguments: ['existing-private-context'] } };
    expect(appCheckBeforeBreadcrumb(breadcrumb, { input: [prefix, warning] })).toBe(breadcrumb);
    expect(observer).toHaveBeenCalledWith({ code: 'appCheck/initial-throttle', httpStatus: 403,
      retryAfterSeconds: 86400, cooldown: true, retryable: false });
    expect(JSON.stringify(observer.mock.calls)).not.toContain('private');
  });

  it('ignores unrelated logs and arbitrary objects without formatting them', () => {
    const observer = vi.fn();
    const toJSON = vi.fn(() => { throw new Error('private-object'); });
    const toString = vi.fn(() => { throw new Error('private-object'); });
    unsubscribe.push(observeInitialAppCheckRejections(observer));
    const crumb = { category: 'console', level: 'warning' };
    for (const input of [undefined, 'private-text', [prefix],
      [prefix, warning, { toJSON, toString }], [prefix, { toJSON, toString }],
      [prefix.replace('app-check', 'firestore'), warning], ['private-prefix', warning], [prefix, 'private-warning']]) {
      expect(appCheckBeforeBreadcrumb(crumb, { input })).toBe(crumb);
    }
    appCheckBeforeBreadcrumb({ category: 'fetch', level: 'warning' }, { input: [prefix, warning] });
    appCheckBeforeBreadcrumb({ category: 'console', level: 'info' }, { input: [prefix, warning] });
    expect(observer).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
  });

  it('removes destroyed observers and contains reporting failures', () => {
    const removed = vi.fn();
    observeInitialAppCheckRejections(removed)();
    unsubscribe.push(observeInitialAppCheckRejections(() => { throw new Error('reporting unavailable'); }));
    const active = vi.fn();
    unsubscribe.push(observeInitialAppCheckRejections(active));
    expect(() => appCheckBeforeBreadcrumb({ category: 'console', level: 'warning' }, { input: [prefix, warning] })).not.toThrow();
    expect(removed).not.toHaveBeenCalled();
    expect(active).toHaveBeenCalledTimes(1);
  });
});
