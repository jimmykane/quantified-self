import { RenderMode, ServerRoute } from '@angular/ssr';
import { WORKOUT_DATA_COMPARISON_PATH } from './components/features/workout-data-comparison-page.content';
import { PUBLIC_FEATURE_PATHS, PUBLIC_GUIDE_PATHS } from './components/public-seo/public-seo-pages.content';

export const PRERENDERED_INTEGRATION_ROUTES = [
  'integrations',
  'integrations/garmin',
  'integrations/suunto',
  'integrations/coros',
] as const;

export const PRERENDERED_FEATURE_ROUTES = [
  PUBLIC_FEATURE_PATHS.hub,
  WORKOUT_DATA_COMPARISON_PATH,
  PUBLIC_FEATURE_PATHS.aiInsights,
  PUBLIC_FEATURE_PATHS.workoutFileComparison,
  PUBLIC_FEATURE_PATHS.fitGpxTcxFileAnalyzer,
  PUBLIC_FEATURE_PATHS.routeFiles,
  PUBLIC_FEATURE_PATHS.sportsWatchBenchmark,
] as const;

export const PRERENDERED_GUIDE_ROUTES = [
  PUBLIC_GUIDE_PATHS.hub,
  PUBLIC_GUIDE_PATHS.syncGarminToSuunto,
  PUBLIC_GUIDE_PATHS.syncCorosToSuunto,
  PUBLIC_GUIDE_PATHS.centralizeWorkoutData,
] as const;

export const PRERENDERED_STATIC_PUBLIC_ROUTES = [
  'help',
] as const;

export const PRERENDERED_TOOLS_ROUTES = [
  'tools',
  'tools/compare',
] as const;

export const PRERENDERED_PUBLIC_ROUTES = [
  '',
  ...PRERENDERED_STATIC_PUBLIC_ROUTES,
  ...PRERENDERED_TOOLS_ROUTES,
  ...PRERENDERED_INTEGRATION_ROUTES,
  ...PRERENDERED_FEATURE_ROUTES,
  ...PRERENDERED_GUIDE_ROUTES,
] as const;

export const CLIENT_RENDERED_APP_ROUTES = [
  'login',
  'onboarding',
  'admin',
  'admin/maintenance',
  'admin/users',
  'admin/changelog',
  'admin/queues/workout',
  'admin/queues/activity-sync',
  'admin/queues/route-delivery-sync',
  'admin/queues/route-sync',
  'admin/queues/sleep-sync',
  'admin/queues/reparse',
  'admin/queues/route-reparse',
  'admin/queues/derived-metrics',
  'pricing',
  'subscriptions',
  'payment/success',
  'payment/cancel',
  'releases',
  'tools/compare/saved',
  'services',
  'dashboard',
  'mytracks',
  'routes',
  'settings',
  'user/:userID/event/:eventID',
  'user/:userID/route/:routeID',
  'policies',
  'ai-insights',
] as const;

export const serverRoutes: ServerRoute[] = [
  ...PRERENDERED_PUBLIC_ROUTES.map(path => ({
    path,
    renderMode: RenderMode.Prerender,
  } as const)),
  ...CLIENT_RENDERED_APP_ROUTES.map(path => ({
    path,
    renderMode: RenderMode.Client,
  } as const)),
  {
    path: '**',
    renderMode: RenderMode.Client,
    status: 404,
  },
];
