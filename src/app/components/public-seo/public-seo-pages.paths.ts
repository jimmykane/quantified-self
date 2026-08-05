export type PublicSeoPageKey =
  | 'featuresHub'
  | 'activityCalendar'
  | 'trainingAnalysis'
  | 'mcpServer'
  | 'aiInsights'
  | 'workoutFileComparison'
  | 'fitGpxTcxFileAnalyzer'
  | 'routeFiles'
  | 'sportsWatchBenchmark'
  | 'guidesHub'
  | 'syncGarminToSuunto'
  | 'syncCorosToSuunto'
  | 'syncWahooToSuunto'
  | 'importActivitiesToSuunto'
  | 'importActivitiesToWahoo'
  | 'syncSuuntoRoutesToGarmin'
  | 'centralizeWorkoutData';

export const PUBLIC_FEATURE_PATHS = {
  hub: 'features',
  activityCalendar: 'features/activity-calendar',
  trainingAnalysis: 'features/training-analysis',
  mcpServer: 'features/mcp-server',
  aiInsights: 'features/ai-insights',
  workoutFileComparison: 'features/workout-file-comparison',
  fitGpxTcxFileAnalyzer: 'features/fit-gpx-tcx-file-analyzer',
  routeFiles: 'features/fit-gpx-route-files',
  sportsWatchBenchmark: 'features/sports-watch-benchmark',
} as const;

export const PUBLIC_GUIDE_PATHS = {
  hub: 'guides',
  syncGarminToSuunto: 'guides/sync-garmin-to-suunto',
  syncCorosToSuunto: 'guides/sync-coros-to-suunto',
  syncWahooToSuunto: 'guides/sync-wahoo-to-suunto',
  importActivitiesToSuunto: 'guides/import-activities-to-suunto',
  importActivitiesToWahoo: 'guides/import-activities-to-wahoo',
  syncSuuntoRoutesToGarmin: 'guides/sync-suunto-routes-to-garmin-courses',
  centralizeWorkoutData: 'guides/centralize-garmin-suunto-coros-workout-data',
} as const;
