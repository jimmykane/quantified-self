import { RenderMode } from '@angular/ssr';
import { describe, expect, it } from 'vitest';
import { routes as appRoutes } from './app.routing.module';
import {
  CLIENT_RENDERED_APP_ROUTES,
  PRERENDERED_FEATURE_ROUTES,
  PRERENDERED_GUIDE_ROUTES,
  PRERENDERED_PUBLIC_ROUTES,
  PRERENDERED_STATIC_PUBLIC_ROUTES,
  serverRoutes,
} from './app.routes.server';
import { adminRoutes } from './modules/admin.module';

function definedRoutePaths(routes: typeof appRoutes): string[] {
  return routes
    .map(route => route.path)
    .filter((path): path is string => path !== undefined && path !== '**');
}

function fullAdminRoutePaths(): string[] {
  return definedRoutePaths(adminRoutes)
    .map(path => path ? `admin/${path}` : 'admin');
}

describe('serverRoutes', () => {
  it('prerenders the public home page, static help page, integration routes, feature routes, and guide routes', () => {
    const prerenderRoutes = serverRoutes.filter(route => route.renderMode === RenderMode.Prerender);

    expect(prerenderRoutes.map(route => route.path)).toEqual([...PRERENDERED_PUBLIC_ROUTES]);
    expect(PRERENDERED_STATIC_PUBLIC_ROUTES).toEqual(['help']);
    expect(PRERENDERED_FEATURE_ROUTES).toEqual([
      'features',
      'features/workout-data-comparison',
      'features/ai-insights',
      'features/workout-file-comparison',
      'features/sports-watch-benchmark',
    ]);
    expect(PRERENDERED_GUIDE_ROUTES).toEqual([
      'guides',
      'guides/sync-garmin-to-suunto',
      'guides/sync-coros-to-suunto',
      'guides/centralize-garmin-suunto-coros-workout-data',
    ]);
  });

  it('keeps private and client-only app routes out of prerendering', () => {
    const prerenderedPaths = new Set(
      serverRoutes
        .filter(route => route.renderMode === RenderMode.Prerender)
        .map(route => route.path)
    );
    expect(prerenderedPaths.has('')).toBe(true);
    expect(prerenderedPaths.has('dashboard')).toBe(false);
    expect(prerenderedPaths.has('settings')).toBe(false);
    expect(prerenderedPaths.has('mytracks')).toBe(false);
    expect(prerenderedPaths.has('pricing')).toBe(false);
    expect(prerenderedPaths.has('help')).toBe(true);
    expect(prerenderedPaths.has('releases')).toBe(false);
    expect(prerenderedPaths.has('ai-insights')).toBe(false);
    expect(prerenderedPaths.has('features')).toBe(true);
    expect(prerenderedPaths.has('features/workout-data-comparison')).toBe(true);
    expect(prerenderedPaths.has('features/ai-insights')).toBe(true);
    expect(prerenderedPaths.has('features/workout-file-comparison')).toBe(true);
    expect(prerenderedPaths.has('features/sports-watch-benchmark')).toBe(true);
    expect(prerenderedPaths.has('guides')).toBe(true);
    expect(prerenderedPaths.has('guides/sync-garmin-to-suunto')).toBe(true);
    expect(prerenderedPaths.has('guides/sync-coros-to-suunto')).toBe(true);
    expect(prerenderedPaths.has('guides/centralize-garmin-suunto-coros-workout-data')).toBe(true);
  });

  it('declares known client-rendered routes before the 404 fallback', () => {
    const clientRoutes = serverRoutes.filter(route => route.renderMode === RenderMode.Client);
    const fallbackRoute = clientRoutes.at(-1);

    expect(clientRoutes.slice(0, -1).map(route => route.path)).toEqual([...CLIENT_RENDERED_APP_ROUTES]);
    expect(CLIENT_RENDERED_APP_ROUTES.every(path => !path.includes('**'))).toBe(true);
    expect(fallbackRoute).toMatchObject({
      path: '**',
      renderMode: RenderMode.Client,
      status: 404,
    });
    expect(clientRoutes.find(route => route.path === 'dashboard')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'pricing')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'releases')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'settings')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'mytracks')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'user/:userID/event/:eventID')?.status).toBeUndefined();
  });

  it('keeps every top-level app route represented in the server render config', () => {
    const serverRoutePaths = new Set([
      ...PRERENDERED_PUBLIC_ROUTES,
      ...CLIENT_RENDERED_APP_ROUTES,
    ]);

    const missingServerRoutes = definedRoutePaths(appRoutes)
      .filter(path => !serverRoutePaths.has(path));

    expect(missingServerRoutes).toEqual([]);
  });

  it('does not keep stale non-admin routes in the server render config', () => {
    const topLevelAppPaths = new Set(definedRoutePaths(appRoutes));
    const validServerPaths = new Set([
      ...topLevelAppPaths,
      ...fullAdminRoutePaths(),
    ]);

    const staleServerRoutes = [
      ...PRERENDERED_PUBLIC_ROUTES,
      ...CLIENT_RENDERED_APP_ROUTES,
    ].filter(path => !validServerPaths.has(path));

    expect(staleServerRoutes).toEqual([]);
  });

  it('keeps exact admin child routes mirrored as client-rendered server routes', () => {
    const expectedAdminRoutes = fullAdminRoutePaths();
    const serverAdminRoutes = CLIENT_RENDERED_APP_ROUTES
      .filter(path => path === 'admin' || path.startsWith('admin/'));

    expect(serverAdminRoutes).toEqual(expectedAdminRoutes);
  });
});
