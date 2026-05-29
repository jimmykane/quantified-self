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
  PUBLIC_FEATURE_PATHS.sportsWatchBenchmark,
] as const;

export const PRERENDERED_GUIDE_ROUTES = [
  PUBLIC_GUIDE_PATHS.hub,
  PUBLIC_GUIDE_PATHS.syncGarminToSuunto,
  PUBLIC_GUIDE_PATHS.syncCorosToSuunto,
  PUBLIC_GUIDE_PATHS.centralizeWorkoutData,
] as const;

export const PRERENDERED_STATIC_PUBLIC_ROUTES = [
  'pricing',
  'help',
  'releases',
] as const;

export const PRERENDERED_PUBLIC_ROUTES = [
  '',
  ...PRERENDERED_STATIC_PUBLIC_ROUTES,
  ...PRERENDERED_INTEGRATION_ROUTES,
  ...PRERENDERED_FEATURE_ROUTES,
  ...PRERENDERED_GUIDE_ROUTES,
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
