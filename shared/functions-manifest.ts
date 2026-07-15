export const SPORTS_LIB_REPARSE_HEAVY_TASK_FUNCTION_NAME = 'processSportsLibReparseHeavyTask';
export const RETRY_SPORTS_LIB_REPARSE_HEAVY_JOB_FUNCTION_NAME = 'retrySportsLibReparseHeavyJob';

export const FUNCTIONS_MANIFEST = {
    // Admin Functions (europe-west2)
    listUsers: { name: 'listUsers', region: 'europe-west2' },
    getQueueStats: { name: 'getQueueStats', region: 'europe-west2' },
    getUserCount: { name: 'getUserCount', region: 'europe-west2' },
    getSubscriptionHistoryTrend: { name: 'getSubscriptionHistoryTrend', region: 'europe-west2' },
    getUserGrowthTrend: { name: 'getUserGrowthTrend', region: 'europe-west2' },
    setMaintenanceMode: { name: 'setMaintenanceMode', region: 'europe-west2' },
    getMaintenanceStatus: { name: 'getMaintenanceStatus', region: 'europe-west2' },
    impersonateUser: { name: 'impersonateUser', region: 'europe-west2' },
    stopImpersonation: { name: 'stopImpersonation', region: 'europe-west2' },
    getFinancialStats: { name: 'getFinancialStats', region: 'europe-west2' },

    // User Functions
    deleteSelf: { name: 'deleteSelf', region: 'europe-west2' },

    // COROS Functions
    getCOROSAPIAuthRequestTokenRedirectURI: { name: 'getCOROSAPIAuthRequestTokenRedirectURI', region: 'europe-west2' },
    requestAndSetCOROSAPIAccessToken: { name: 'requestAndSetCOROSAPIAccessToken', region: 'europe-west2' },
    deauthorizeCOROSAPI: { name: 'deauthorizeCOROSAPI', region: 'europe-west2' },
    addCOROSAPIHistoryToQueue: { name: 'addCOROSAPIHistoryToQueue', region: 'europe-west2' },
    importActivityToCOROSAPI: { name: 'importActivityToCOROSAPI', region: 'europe-west2' },

    // Suunto Functions
    getSuuntoAPIAuthRequestTokenRedirectURI: { name: 'getSuuntoAPIAuthRequestTokenRedirectURI', region: 'europe-west2' },
    requestAndSetSuuntoAPIAccessToken: { name: 'requestAndSetSuuntoAPIAccessToken', region: 'europe-west2' },
    deauthorizeSuuntoApp: { name: 'deauthorizeSuuntoApp', region: 'europe-west2' },
    addSuuntoAppHistoryToQueue: { name: 'addSuuntoAppHistoryToQueue', region: 'europe-west2' },
    addSuuntoAppRoutesToQueue: { name: 'addSuuntoAppRoutesToQueue', region: 'europe-west2' },
    backfillRouteDeliverySyncRoute: { name: 'backfillRouteDeliverySyncRoute', region: 'europe-west2' },
    backfillSuuntoAppSleep: { name: 'backfillSuuntoAppSleep', region: 'europe-west2' },
    importRouteToSuuntoApp: { name: 'importRouteToSuuntoApp', region: 'europe-west2' },
    sendRoutesToService: { name: 'sendRoutesToService', region: 'europe-west2' },
    importActivityToSuuntoApp: { name: 'importActivityToSuuntoApp', region: 'europe-west2' },
    getSuuntoFITFile: { name: 'getSuuntoFITFile', region: 'europe-west2' },

    // Garmin Functions
    getGarminAPIAuthRequestTokenRedirectURI: { name: 'getGarminAPIAuthRequestTokenRedirectURI', region: 'europe-west2' },
    requestAndSetGarminAPIAccessToken: { name: 'requestAndSetGarminAPIAccessToken', region: 'europe-west2' },
    deauthorizeGarminAPI: { name: 'deauthorizeGarminAPI', region: 'europe-west2' },
    backfillGarminAPIActivities: { name: 'backfillGarminAPIActivities', region: 'europe-west2' },
    backfillGarminAPISleep: { name: 'backfillGarminAPISleep', region: 'europe-west2' },
    receiveGarminAPIDeregistration: { name: 'receiveGarminAPIDeregistration', region: 'europe-west2' },
    receiveGarminAPIUserPermissions: { name: 'receiveGarminAPIUserPermissions', region: 'europe-west2' },
    backfillActivitySyncRoute: { name: 'backfillActivitySyncRoute', region: 'europe-west2' },
    // Stripe Functions
    restoreUserClaims: { name: 'restoreUserClaims', region: 'europe-west2' },
    linkExistingStripeCustomer: { name: 'linkExistingStripeCustomer', region: 'europe-west2' },
    cleanupStripeCustomer: { name: 'cleanupStripeCustomer', region: 'europe-west2' },
    getUpcomingRenewalAmount: { name: 'getUpcomingRenewalAmount', region: 'europe-west2' },
    createPortalLink: { name: 'ext-firestore-stripe-payments-createPortalLink', region: 'europe-west3' },

    // Reparse Functions
    scheduleSportsLibReparseScan: { name: 'scheduleSportsLibReparseScan', region: 'europe-west2' },
    scheduleSportsLibRouteReparseScan: { name: 'scheduleSportsLibRouteReparseScan', region: 'europe-west2' },
    processSportsLibReparseTask: { name: 'processSportsLibReparseTask', region: 'europe-west2' },
    processSportsLibReparseHeavyTask: { name: SPORTS_LIB_REPARSE_HEAVY_TASK_FUNCTION_NAME, region: 'europe-west2' },
    processSportsLibRouteReparseTask: { name: 'processSportsLibRouteReparseTask', region: 'europe-west2' },
    processRouteDeliverySyncTask: { name: 'processRouteDeliverySyncTask', region: 'europe-west2' },

    // Upload/Reprocess Functions
    uploadActivity: { name: 'uploadActivity', region: 'europe-west2' },
    uploadRoute: { name: 'uploadRoute', region: 'europe-west2' },
    createToolComparisonEvent: { name: 'createToolComparisonEvent', region: 'europe-west2' },
    reprocessEvent: { name: 'reprocessEvent', region: 'europe-west2' },
    setEventSharing: { name: 'setEventSharing', region: 'europe-west2' },
    reprocessRoute: { name: 'reprocessRoute', region: 'europe-west2' },
    retrySportsLibReparseHeavyJob: { name: RETRY_SPORTS_LIB_REPARSE_HEAVY_JOB_FUNCTION_NAME, region: 'europe-west2' },
    mergeEvents: { name: 'mergeEvents', region: 'europe-west2' },
    aiInsights: { name: 'aiInsights', region: 'europe-west2' },
    getAiInsightsQuotaStatus: { name: 'getAiInsightsQuotaStatus', region: 'europe-west2' },
    ensureDerivedMetrics: { name: 'ensureDerivedMetrics', region: 'europe-west2' },
    setTrainingBuildBenchmark: { name: 'setTrainingBuildBenchmark', region: 'europe-west2' },
    setTrainingVisibleDisciplines: { name: 'setTrainingVisibleDisciplines', region: 'europe-west2' },
    processDerivedMetricsIngressTask: { name: 'processDerivedMetricsIngressTask', region: 'europe-west2' },
} as const;

export type FunctionName = keyof typeof FUNCTIONS_MANIFEST;
export type FunctionConfig = typeof FUNCTIONS_MANIFEST[FunctionName];
