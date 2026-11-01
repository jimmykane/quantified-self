export type PublicSeoPageKey =
  | 'featuresHub'
  | 'health'
  | 'activityCalendar'
  | 'trainingAnalysis'
  | 'trainingPlans'
  | 'trainingDashboard'
  | 'activityMap'
  | 'mcpServer'
  | 'assistant'
  | 'fitGpxTcxFileAnalyzer'
  | 'routeFiles'
  | 'guidesHub'
  | 'importStravaToSuunto'
  | 'importStravaToGarmin'
  | 'importStravaToWahoo'
  | 'importStravaToCoros'
  | 'syncGarminToSuunto'
  | 'syncGarminToWahoo'
  | 'syncCorosToSuunto'
  | 'syncWahooToSuunto'
  | 'importActivitiesToSuunto'
  | 'importActivitiesToWahoo'
  | 'syncSuuntoRoutesToGarmin'
  | 'centralizeWorkoutData';

export const PUBLIC_FEATURE_PATHS = {
  hub: 'features',
  health: 'features/health',
  activityCalendar: 'features/activity-calendar',
  trainingAnalysis: 'features/training-analysis',
  trainingPlans: 'features/training-plans',
  trainingDashboard: 'features/training-dashboard',
  activityMap: 'features/activity-map',
  mcpServer: 'features/mcp-server',
  assistant: 'features/ai-insights',
  fitGpxTcxFileAnalyzer: 'features/fit-gpx-tcx-file-analyzer',
  routeFiles: 'features/fit-gpx-route-files',
} as const;

export const PUBLIC_GUIDE_PATHS = {
  hub: 'guides',
  importStravaToSuunto: 'guides/strava-to-suunto',
  importStravaToGarmin: 'guides/strava-to-garmin',
  importStravaToWahoo: 'guides/strava-to-wahoo',
  importStravaToCoros: 'guides/strava-to-coros',
  syncGarminToSuunto: 'guides/sync-garmin-to-suunto',
  syncGarminToWahoo: 'guides/sync-garmin-to-wahoo',
  syncCorosToSuunto: 'guides/sync-coros-to-suunto',
  syncWahooToSuunto: 'guides/sync-wahoo-to-suunto',
  importActivitiesToSuunto: 'guides/import-activities-to-suunto',
  importActivitiesToWahoo: 'guides/import-activities-to-wahoo',
  syncSuuntoRoutesToGarmin: 'guides/sync-suunto-routes-to-garmin-courses',
  centralizeWorkoutData: 'guides/centralize-garmin-suunto-coros-workout-data',
} as const;
