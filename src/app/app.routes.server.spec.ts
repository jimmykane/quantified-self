import { RenderMode } from '@angular/ssr';
import { describe, expect, it } from 'vitest';
import {
  PRERENDERED_FEATURE_ROUTES,
  PRERENDERED_GUIDE_ROUTES,
  PRERENDERED_PUBLIC_ROUTES,
  PRERENDERED_STATIC_PUBLIC_ROUTES,
  serverRoutes,
} from './app.routes.server';

describe('serverRoutes', () => {
  it('prerenders the public home page, static public pages, integration routes, feature routes, and guide routes', () => {
    const prerenderRoutes = serverRoutes.filter(route => route.renderMode === RenderMode.Prerender);

    expect(prerenderRoutes.map(route => route.path)).toEqual([...PRERENDERED_PUBLIC_ROUTES]);
    expect(PRERENDERED_STATIC_PUBLIC_ROUTES).toEqual(['pricing', 'help', 'releases']);
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

  it('keeps private app routes and unknown public paths client-rendered', () => {
    const prerenderedPaths = new Set(
      serverRoutes
        .filter(route => route.renderMode === RenderMode.Prerender)
        .map(route => route.path)
    );
    const clientFallback = serverRoutes.find(route => route.path === '**');

    expect(clientFallback?.renderMode).toBe(RenderMode.Client);
    expect(prerenderedPaths.has('')).toBe(true);
    expect(prerenderedPaths.has('dashboard')).toBe(false);
    expect(prerenderedPaths.has('settings')).toBe(false);
    expect(prerenderedPaths.has('mytracks')).toBe(false);
    expect(prerenderedPaths.has('pricing')).toBe(true);
    expect(prerenderedPaths.has('help')).toBe(true);
    expect(prerenderedPaths.has('releases')).toBe(true);
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
});
