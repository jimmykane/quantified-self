import { RenderMode, ServerRoute } from '@angular/ssr';

export const PRERENDERED_INTEGRATION_ROUTES = [
  'integrations',
  'integrations/garmin',
  'integrations/suunto',
  'integrations/coros',
] as const;

export const serverRoutes: ServerRoute[] = [
  ...PRERENDERED_INTEGRATION_ROUTES.map(path => ({
    path,
    renderMode: RenderMode.Prerender,
  } as const)),
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
