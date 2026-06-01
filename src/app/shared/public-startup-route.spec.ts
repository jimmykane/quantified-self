import { describe, expect, it } from 'vitest';
import { PRERENDERED_PUBLIC_ROUTES } from '../app.routes.server';
import { isPublicStartupPath } from './public-startup-route';

function toStartupPath(routePath: string): string {
  return routePath ? `/${routePath}` : '/';
}

describe('public-startup-route', () => {
  it('keeps every prerendered public route visible while browser auth resolves', () => {
    for (const routePath of PRERENDERED_PUBLIC_ROUTES) {
      expect(isPublicStartupPath(toStartupPath(routePath))).toBe(true);
    }
  });

  it('normalizes query strings, hashes, and trailing slashes before matching', () => {
    expect(isPublicStartupPath('/tools/compare/?utm_source=test#new')).toBe(true);
  });

  it('keeps the client-rendered saved comparisons route visible during auth startup', () => {
    expect(isPublicStartupPath('/tools/compare/saved')).toBe(true);
  });
});
