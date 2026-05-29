import { RenderMode, ServerRoute } from '@angular/ssr';

export const PRERENDERED_INTEGRATION_ROUTES = [
  'integrations',
  'integrations/garmin',
  'integrations/suunto',
  'integrations/coros',
] as const;

export const PRERENDERED_FEATURE_ROUTES = [
  'features/workout-data-comparison',
] as const;

export const PRERENDERED_PUBLIC_ROUTES = [
  '',
  ...PRERENDERED_INTEGRATION_ROUTES,
  ...PRERENDERED_FEATURE_ROUTES,
] as const;

export const serverRoutes: ServerRoute[] = [
  ...PRERENDERED_PUBLIC_ROUTES.map(path => ({
    path,
    renderMode: RenderMode.Prerender,
  } as const)),
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
