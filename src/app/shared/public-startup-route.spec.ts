import { describe, expect, it } from 'vitest';
import { PRERENDERED_PUBLIC_ROUTES } from '../app.routes.server';
import {
  isAuthSensitivePublicStartupPath,
  isPublicStartupPath,
  isRouteLoaderSuppressedStartupPath,
  shouldProvideClientHydrationForRuntime,
} from './public-startup-route';

function toStartupPath(routePath: string): string {
  return routePath ? `/${routePath}` : '/';
}

function htmlDocument(markup: string): Document {
  const testDocument = document.implementation.createHTMLDocument('test');
  testDocument.body.innerHTML = markup;
  return testDocument;
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

  it('keeps dynamic share routes visible during auth startup', () => {
    expect(isPublicStartupPath('/share/event/user-1/event-1')).toBe(true);
    expect(isPublicStartupPath('/share/comparison/user-1/event-1?utm_source=test')).toBe(true);
    expect(isPublicStartupPath('/share/unknown/user-1/event-1')).toBe(false);
  });

  it('does not suppress the route loader for dynamic share startup routes', () => {
    expect(isRouteLoaderSuppressedStartupPath('/features')).toBe(true);
    expect(isRouteLoaderSuppressedStartupPath('/share/event/user-1/event-1')).toBe(false);
    expect(isRouteLoaderSuppressedStartupPath('/share/comparison/user-1/event-1')).toBe(false);
  });

  it('marks compare routes as auth-sensitive public startup paths', () => {
    expect(isAuthSensitivePublicStartupPath('/tools/compare')).toBe(true);
    expect(isAuthSensitivePublicStartupPath('/tools/compare/saved')).toBe(true);
    expect(isAuthSensitivePublicStartupPath('/features/fit-gpx-tcx-file-analyzer')).toBe(false);
  });

  it('provides hydration while the server render serializes prerendered documents', () => {
    expect(shouldProvideClientHydrationForRuntime(undefined, false)).toBe(true);
  });

  it('provides hydration in the browser for prerendered Angular documents', () => {
    const testDocument = htmlDocument('<app-root ng-server-context="ssg"></app-root>');

    expect(shouldProvideClientHydrationForRuntime(testDocument, true)).toBe(true);
  });

  it('skips hydration for Google Translate proxy documents even when prerendered', () => {
    const appRoot = document.createElement('app-root');
    appRoot.setAttribute('ng-server-context', 'ssg');
    const testDocument = {
      location: { hostname: 'quantified--self-io.translate.goog' },
      querySelector: (selector: string) => selector === 'app-root[ng-server-context]' ? appRoot : null,
    } as unknown as Document;

    expect(shouldProvideClientHydrationForRuntime(testDocument, true)).toBe(false);
  });

  it('skips hydration in the browser for client-rendered startup documents', () => {
    const testDocument = htmlDocument('<app-root></app-root>');

    expect(shouldProvideClientHydrationForRuntime(testDocument, true)).toBe(false);
  });
});
