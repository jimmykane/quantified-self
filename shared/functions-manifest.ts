export const SPORTS_LIB_REPARSE_HEAVY_TASK_FUNCTION_NAME = 'processSportsLibReparseHeavyTask';
export const RETRY_SPORTS_LIB_REPARSE_HEAVY_JOB_FUNCTION_NAME = 'retrySportsLibReparseHeavyJob';
export const MERGE_EVENTS_CLIENT_TIMEOUT_MS = 61 * 60 * 1000;
export const COROS_HISTORY_IMPORT_CLIENT_TIMEOUT_MS = 310_000;

export const FUNCTIONS_MANIFEST = {
    // Admin Functions (europe-west2)
    listUsers: { name: 'listUsers', region: 'europe-west2' },
    getQueueStats: { name: 'getQueueStats', region: 'europe-west2' },
    getUserCount: { name: 'getUserCount', region: 'europe-west2' },
    getAdminDashboardHistory: { name: 'getAdminDashboardHistory', region: 'europe-west2' },
    scheduleAdminDashboardSnapshot: { name: 'scheduleAdminDashboardSnapshot', region: 'europe-west2' },
    getSubscriptionHistoryTrend: { name: 'getSubscriptionHistoryTrend', region: 'europe-west2' },
    getUserGrowthTrend: { name: 'getUserGrowthTrend', region: 'europe-west2' },
    setMaintenanceMode: { name: 'setMaintenanceMode', region: 'europe-west2' },
    getMaintenanceStatus: { name: 'getMaintenanceStatus', region: 'europe-west2' },
    impersonateUser: { name: 'impersonateUser', region: 'europe-west2' },
    stopImpersonation: { name: 'stopImpersonation', region: 'europe-west2' },
    getFinancialStats: { name: 'getFinancialStats', region: 'europe-west2' },

    // User Functions
    deleteSelf: { name: 'deleteSelf', region: 'europe-west2' },
    getMcpAuthorizationRequest: { name: 'getMcpAuthorizationRequest', region: 'europe-west2' },
    decideMcpAuthorization: { name: 'decideMcpAuthorization', region: 'europe-west2' },
    listMcpConnections: { name: 'listMcpConnections', region: 'europe-west2' },
    revokeMcpConnection: { name: 'revokeMcpConnection', region: 'europe-west2' },
    queryHealthRange: { name: 'queryHealthRange', region: 'europe-west2' },

    // COROS Functions
    getCOROSAPIAuthRequestTokenRedirectURI: { name: 'getCOROSAPIAuthRequestTokenRedirectURI', region: 'europe-west2' },
    requestAndSetCOROSAPIAccessToken: { name: 'requestAndSetCOROSAPIAccessToken', region: 'europe-west2' },
    deauthorizeCOROSAPI: { name: 'deauthorizeCOROSAPI', region: 'europe-west2' },
    getCOROSAPIBindingState: { name: 'getCOROSAPIBindingState', region: 'europe-west2' },
    addCOROSAPIHistoryToQueue: {
        name: 'addCOROSAPIHistoryToQueue',
        region: 'europe-west2',
        clientTimeoutMs: COROS_HISTORY_IMPORT_CLIENT_TIMEOUT_MS,
    },
    backfillCorosAPISleep: { name: 'backfillCorosAPISleep', region: 'europe-west2' },
    importActivityToCOROSAPI: { name: 'importActivityToCOROSAPI', region: 'europe-west2' },
    getCOROSAPIWorkoutFileUploadStatus: { name: 'getCOROSAPIWorkoutFileUploadStatus', region: 'europe-west2' },
    importRouteToCOROSAPI: { name: 'importRouteToCOROSAPI', region: 'europe-west2' },

    // Wahoo Functions
    getWahooAPIAuthRequestTokenRedirectURI: { name: 'getWahooAPIAuthRequestTokenRedirectURI', region: 'europe-west2' },
    requestAndSetWahooAPIAccessToken: { name: 'requestAndSetWahooAPIAccessToken', region: 'europe-west2' },
    deauthorizeWahooAPI: { name: 'deauthorizeWahooAPI', region: 'europe-west2' },
    getWahooAPIConnectionAccount: { name: 'getWahooAPIConnectionAccount', region: 'europe-west2' },
    addWahooAPIHistoryToQueue: { name: 'addWahooAPIHistoryToQueue', region: 'europe-west2' },
    importActivityToWahooAPI: { name: 'importActivityToWahooAPI', region: 'europe-west2' },
    getWahooAPIWorkoutFileUploadStatus: { name: 'getWahooAPIWorkoutFileUploadStatus', region: 'europe-west2' },
    importRouteToWahooAPI: { name: 'importRouteToWahooAPI', region: 'europe-west2' },

    // Suunto Functions
    getSuuntoAPIAuthRequestTokenRedirectURI: { name: 'getSuuntoAPIAuthRequestTokenRedirectURI', region: 'europe-west2' },
    requestAndSetSuuntoAPIAccessToken: { name: 'requestAndSetSuuntoAPIAccessToken', region: 'europe-west2' },
    deauthorizeSuuntoApp: { name: 'deauthorizeSuuntoApp', region: 'europe-west2' },
    addSuuntoAppHistoryToQueue: { name: 'addSuuntoAppHistoryToQueue', region: 'europe-west2' },
    addSuuntoAppRoutesToQueue: { name: 'addSuuntoAppRoutesToQueue', region: 'europe-west2' },
    backfillRouteDeliverySyncRoute: { name: 'backfillRouteDeliverySyncRoute', region: 'europe-west2' },
    backfillSuuntoAppSleep: { name: 'backfillSuuntoAppSleep', region: 'europe-west2' },
    getSuuntoHealthSyncAvailability: { name: 'getSuuntoHealthSyncAvailability', region: 'europe-west2' },
    importRouteToSuuntoApp: { name: 'importRouteToSuuntoApp', region: 'europe-west2' },
    sendRoutesToService: { name: 'sendRoutesToService', region: 'europe-west2' },
    importActivityToSuuntoApp: { name: 'importActivityToSuuntoApp', region: 'europe-west2' },
    getSuuntoFITFile: { name: 'getSuuntoFITFile', region: 'europe-west2' },

    // Garmin Functions
    getGarminAPIAuthRequestTokenRedirectURI: { name: 'getGarminAPIAuthRequestTokenRedirectURI', region: 'europe-west2' },
    requestAndSetGarminAPIAccessToken: { name: 'requestAndSetGarminAPIAccessToken', region: 'europe-west2' },
    deauthorizeGarminAPI: { name: 'deauthorizeGarminAPI', region: 'europe-west2' },
    importRouteToGarminAPI: { name: 'importRouteToGarminAPI', region: 'europe-west2' },
    backfillGarminAPIActivities: { name: 'backfillGarminAPIActivities', region: 'europe-west2' },
    backfillGarminAPIHealth: { name: 'backfillGarminAPIHealth', region: 'europe-west2' },
    backfillGarminAPISleep: { name: 'backfillGarminAPISleep', region: 'europe-west2' },
    getGarminHealthSyncAvailability: { name: 'getGarminHealthSyncAvailability', region: 'europe-west2' },
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
    processGarminHealthBackfillTask: { name: 'processGarminHealthBackfillTask', region: 'europe-west2' },

    // Upload/Reprocess Functions
    uploadActivity: { name: 'uploadActivity', region: 'europe-west2' },
    uploadRoute: { name: 'uploadRoute', region: 'europe-west2' },
    createToolComparisonEvent: { name: 'createToolComparisonEvent', region: 'europe-west2' },
    reprocessEvent: { name: 'reprocessEvent', region: 'europe-west2' },
    setEventSharing: { name: 'setEventSharing', region: 'europe-west2' },
    reprocessRoute: { name: 'reprocessRoute', region: 'europe-west2' },
    retrySportsLibReparseHeavyJob: { name: RETRY_SPORTS_LIB_REPARSE_HEAVY_JOB_FUNCTION_NAME, region: 'europe-west2' },
    // The Firebase callable SDK defaults to 70 seconds, while this function has
    // a 60-minute server budget. Keep the client deadline just beyond it.
    mergeEvents: {
        name: 'mergeEvents',
        region: 'europe-west2',
        clientTimeoutMs: MERGE_EVENTS_CLIENT_TIMEOUT_MS,
    },
    // Grounded turns can use several bounded MCP tool calls before generation.
    // Keep the client deadline just beyond the callable's 180-second budget.
    assistantChat: {
        name: 'assistantChat',
        region: 'europe-west2',
        clientTimeoutMs: 190_000,
    },
    getAssistantQuotaStatus: { name: 'getAssistantQuotaStatus', region: 'europe-west2' },
    getAssistantConversation: { name: 'getAssistantConversation', region: 'europe-west2' },
    resetAssistantConversation: { name: 'resetAssistantConversation', region: 'europe-west2' },
    ensureDerivedMetrics: { name: 'ensureDerivedMetrics', region: 'europe-west2' },
    setTrainingBuildBenchmark: { name: 'setTrainingBuildBenchmark', region: 'europe-west2' },
    processDerivedMetricsIngressTask: { name: 'processDerivedMetricsIngressTask', region: 'europe-west2' },
} as const;

export type FunctionName = keyof typeof FUNCTIONS_MANIFEST;
export type FunctionConfig = typeof FUNCTIONS_MANIFEST[FunctionName];
