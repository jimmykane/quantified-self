import { RenderMode } from '@angular/ssr';
import { describe, expect, it } from 'vitest';
import { publicLayoutRoutes, routes as appRoutes } from './app.routing.module';
import { PublicLayoutComponent } from './components/public-layout/public-layout.component';
import {
  CLIENT_RENDERED_APP_ROUTES,
  PRERENDERED_FEATURE_ROUTES,
  PRERENDERED_GUIDE_ROUTES,
  PRERENDERED_PUBLIC_ROUTES,
  PRERENDERED_STATIC_PUBLIC_ROUTES,
  PRERENDERED_TOOLS_ROUTES,
  serverRoutes,
} from './app.routes.server';
import { dashboardRoutes } from './dashboard.routing.module';
import { eventRoutes } from './event.routing.module';
import { homeRoutes } from './home.routing.module';
import { loginRoutes } from './login.routing.module';
import { adminRoutes } from './modules/admin.module';
import { myTracksRoutes } from './my-tracks.routing.module';
import { policiesRoutes } from './policies.routing.module';
import { servicesRoutes } from './services.routing.module';
import { userRoutes } from './user.routing.module';

function definedRoutePaths(routes: typeof appRoutes): string[] {
  return routes.flatMap(route => {
    if (route.children) {
      return definedRoutePaths(route.children);
    }

    return route.path !== undefined && route.path !== '**' ? [route.path] : [];
  });
}

function fullAdminRoutePaths(): string[] {
  return definedRoutePaths(adminRoutes)
    .map(path => path ? `admin/${path}` : 'admin');
}

const rootOnlyLazyRouteModules = [
  ['dashboard', dashboardRoutes],
  ['event', eventRoutes],
  ['home', homeRoutes],
  ['login', loginRoutes],
  ['mytracks', myTracksRoutes],
  ['policies', policiesRoutes],
  ['services', servicesRoutes],
  ['settings', userRoutes],
] as const;

describe('serverRoutes', () => {
  it('prerenders the public home page, static help page, integration routes, feature routes, and guide routes', () => {
    const prerenderRoutes = serverRoutes.filter(route => route.renderMode === RenderMode.Prerender);

    expect(prerenderRoutes.map(route => route.path)).toEqual([...PRERENDERED_PUBLIC_ROUTES]);
    expect(PRERENDERED_STATIC_PUBLIC_ROUTES).toEqual(['help']);
    expect(PRERENDERED_TOOLS_ROUTES).toEqual([
      'tools',
      'tools/compare',
    ]);
    expect(PRERENDERED_FEATURE_ROUTES).toEqual([
      'features',
      'features/workout-data-comparison',
      'features/training-analysis',
      'features/ai-insights',
      'features/workout-file-comparison',
      'features/fit-gpx-tcx-file-analyzer',
      'features/fit-gpx-route-files',
      'features/sports-watch-benchmark',
    ]);
    expect(PRERENDERED_GUIDE_ROUTES).toEqual([
      'guides',
      'guides/sync-garmin-to-suunto',
      'guides/sync-coros-to-suunto',
      'guides/sync-wahoo-to-suunto',
      'guides/sync-suunto-routes-to-garmin-courses',
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
    expect(prerenderedPaths.has('routes')).toBe(false);
    expect(prerenderedPaths.has('share/event/:userID/:eventID')).toBe(false);
    expect(prerenderedPaths.has('share/comparison/:userID/:eventID')).toBe(false);
    expect(prerenderedPaths.has('pricing')).toBe(false);
    expect(prerenderedPaths.has('help')).toBe(true);
    expect(prerenderedPaths.has('releases')).toBe(false);
    expect(prerenderedPaths.has('ai-insights')).toBe(false);
    expect(prerenderedPaths.has('tools')).toBe(true);
    expect(prerenderedPaths.has('tools/compare')).toBe(true);
    expect(prerenderedPaths.has('tools/compare/saved')).toBe(false);
    expect(prerenderedPaths.has('features')).toBe(true);
    expect(prerenderedPaths.has('features/workout-data-comparison')).toBe(true);
    expect(prerenderedPaths.has('features/training-analysis')).toBe(true);
    expect(prerenderedPaths.has('features/ai-insights')).toBe(true);
    expect(prerenderedPaths.has('features/workout-file-comparison')).toBe(true);
    expect(prerenderedPaths.has('features/fit-gpx-tcx-file-analyzer')).toBe(true);
    expect(prerenderedPaths.has('features/fit-gpx-route-files')).toBe(true);
    expect(prerenderedPaths.has('features/sports-watch-benchmark')).toBe(true);
    expect(prerenderedPaths.has('guides')).toBe(true);
    expect(prerenderedPaths.has('guides/sync-garmin-to-suunto')).toBe(true);
    expect(prerenderedPaths.has('guides/sync-coros-to-suunto')).toBe(true);
    expect(prerenderedPaths.has('guides/sync-wahoo-to-suunto')).toBe(true);
    expect(prerenderedPaths.has('guides/sync-suunto-routes-to-garmin-courses')).toBe(true);
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
    expect(clientRoutes.find(route => route.path === 'tools/compare/saved')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'settings')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'mytracks')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'routes')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'share/event/:userID/:eventID')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'share/comparison/:userID/:eventID')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'user/:userID/event/:eventID')?.status).toBeUndefined();
    expect(clientRoutes.find(route => route.path === 'user/:userID/route/:routeID')?.status).toBeUndefined();
  });

  it('keeps every app route represented in the server render config', () => {
    const serverRoutePaths = new Set([
      ...PRERENDERED_PUBLIC_ROUTES,
      ...CLIENT_RENDERED_APP_ROUTES,
    ]);

    const missingServerRoutes = definedRoutePaths(appRoutes)
      .filter(path => !serverRoutePaths.has(path));

    expect(missingServerRoutes).toEqual([]);
  });

  it('does not keep stale non-admin routes in the server render config', () => {
    const appRoutePaths = new Set(definedRoutePaths(appRoutes));
    const validServerPaths = new Set([
      ...appRoutePaths,
      ...fullAdminRoutePaths(),
    ]);

    const staleServerRoutes = [
      ...PRERENDERED_PUBLIC_ROUTES,
      ...CLIENT_RENDERED_APP_ROUTES,
    ].filter(path => !validServerPaths.has(path));

    expect(staleServerRoutes).toEqual([]);
  });

  it('puts every footer-bearing route inside the public layout, never the admin route', () => {
    const publicLayout = appRoutes.at(-1);

    expect(publicLayout).toMatchObject({
      path: '',
      component: PublicLayoutComponent,
      children: publicLayoutRoutes,
    });
    expect(publicLayoutRoutes.some(route => route.path === 'admin')).toBe(false);
    expect(publicLayoutRoutes.some(route => route.path === 'help')).toBe(true);
    expect(publicLayoutRoutes.some(route => route.path === '**')).toBe(true);
  });

  it('keeps exact admin child routes mirrored as client-rendered server routes', () => {
    const expectedAdminRoutes = fullAdminRoutePaths();
    const serverAdminRoutes = CLIENT_RENDERED_APP_ROUTES
      .filter(path => path === 'admin' || path.startsWith('admin/'));

    expect(serverAdminRoutes).toEqual(expectedAdminRoutes);
  });

  it('documents lazy modules that do not currently expose deep-link child routes', () => {
    for (const [routeName, childRoutes] of rootOnlyLazyRouteModules) {
      expect(childRoutes, routeName).toHaveLength(1);
      expect(childRoutes[0]?.path, routeName).toBe('');
      expect(childRoutes[0]?.matcher, routeName).toBeUndefined();
    }
  });
});
