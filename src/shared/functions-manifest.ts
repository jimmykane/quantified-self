
export const FUNCTIONS_MANIFEST = {
    // Admin Functions (europe-west2)
    listUsers: { name: 'listUsers', region: 'europe-west2' },
    getQueueStats: { name: 'getQueueStats', region: 'europe-west2' },
    getUserCount: { name: 'getUserCount', region: 'europe-west2' },
    setMaintenanceMode: { name: 'setMaintenanceMode', region: 'europe-west2' },
    getMaintenanceStatus: { name: 'getMaintenanceStatus', region: 'europe-west2' },
    impersonateUser: { name: 'impersonateUser', region: 'europe-west2' },
    getFinancialStats: { name: 'getFinancialStats', region: 'europe-west2' }
} as const;

export type FunctionName = keyof typeof FUNCTIONS_MANIFEST;
export type FunctionConfig = typeof FUNCTIONS_MANIFEST[FunctionName];
