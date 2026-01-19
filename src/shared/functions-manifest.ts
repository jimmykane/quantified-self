
export const FUNCTIONS_MANIFEST = {
    // Admin Functions (europe-west2)
    listUsers: { name: 'listUsers', region: 'europe-west2' },
    getQueueStats: { name: 'getQueueStats', region: 'europe-west2' },
    getUserCount: { name: 'getUserCount', region: 'europe-west2' },
    setMaintenanceMode: { name: 'setMaintenanceMode', region: 'europe-west2' },
    getMaintenanceStatus: { name: 'getMaintenanceStatus', region: 'europe-west2' },
    impersonateUser: { name: 'impersonateUser', region: 'europe-west2' },
    getFinancialStats: { name: 'getFinancialStats', region: 'europe-west2' },

    // User Functions
    deleteSelf: { name: 'deleteSelf', region: 'europe-west2' },

    // COROS Functions
    getCOROSAPIAuthRequestTokenRedirectURI: { name: 'getCOROSAPIAuthRequestTokenRedirectURI', region: 'europe-west2' },
    requestAndSetCOROSAPIAccessToken: { name: 'requestAndSetCOROSAPIAccessToken', region: 'europe-west2' },
    deauthorizeCOROSAPI: { name: 'deauthorizeCOROSAPI', region: 'europe-west2' },
    addCOROSAPIHistoryToQueue: { name: 'addCOROSAPIHistoryToQueue', region: 'europe-west2' },

    // Suunto Functions
    getSuuntoAPIAuthRequestTokenRedirectURI: { name: 'getSuuntoAPIAuthRequestTokenRedirectURI', region: 'europe-west2' },
    requestAndSetSuuntoAPIAccessToken: { name: 'requestAndSetSuuntoAPIAccessToken', region: 'europe-west2' },
    deauthorizeSuuntoApp: { name: 'deauthorizeSuuntoApp', region: 'europe-west2' },
    addSuuntoAppHistoryToQueue: { name: 'addSuuntoAppHistoryToQueue', region: 'europe-west2' },

    // Garmin Functions
    getGarminAPIAuthRequestTokenRedirectURI: { name: 'getGarminAPIAuthRequestTokenRedirectURI', region: 'europe-west2' },
    requestAndSetGarminAPIAccessToken: { name: 'requestAndSetGarminAPIAccessToken', region: 'europe-west2' },
    deauthorizeGarminAPI: { name: 'deauthorizeGarminAPI', region: 'europe-west2' },
    backfillGarminAPIActivities: { name: 'backfillGarminAPIActivities', region: 'europe-west2' },
} as const;

export type FunctionName = keyof typeof FUNCTIONS_MANIFEST;
export type FunctionConfig = typeof FUNCTIONS_MANIFEST[FunctionName];
