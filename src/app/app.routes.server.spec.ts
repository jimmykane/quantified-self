import { RenderMode } from '@angular/ssr';
import { describe, expect, it } from 'vitest';
import { PRERENDERED_INTEGRATION_ROUTES, serverRoutes } from './app.routes.server';

describe('serverRoutes', () => {
  it('prerenders only the public integration SEO routes', () => {
    const prerenderRoutes = serverRoutes.filter(route => route.renderMode === RenderMode.Prerender);

    expect(prerenderRoutes.map(route => route.path)).toEqual([...PRERENDERED_INTEGRATION_ROUTES]);
  });

  it('keeps root, private app routes, and non-selected public routes client-rendered', () => {
    const prerenderedPaths = new Set(
      serverRoutes
        .filter(route => route.renderMode === RenderMode.Prerender)
        .map(route => route.path)
    );
    const clientFallback = serverRoutes.find(route => route.path === '**');

    expect(clientFallback?.renderMode).toBe(RenderMode.Client);
    expect(prerenderedPaths.has('')).toBe(false);
    expect(prerenderedPaths.has('dashboard')).toBe(false);
    expect(prerenderedPaths.has('settings')).toBe(false);
    expect(prerenderedPaths.has('mytracks')).toBe(false);
    expect(prerenderedPaths.has('pricing')).toBe(false);
    expect(prerenderedPaths.has('help')).toBe(false);
    expect(prerenderedPaths.has('releases')).toBe(false);
    expect(prerenderedPaths.has('ai-insights')).toBe(false);
  });
});
