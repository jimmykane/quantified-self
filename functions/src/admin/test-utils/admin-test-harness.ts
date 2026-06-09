import { vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';

const {
    mockListUsers,
    mockCreateCustomToken,
    mockGetUser,
    mockAuth,
    mockOnCall,
    mockCollection,
    mockDoc,
    mockFirestore,
    mockRemoteConfig,
    mockStripeClient,
    mockGetProjectBillingInfo,
    mockGetBillingAccount,
    mockListBudgets,
    mockGetTables,
    mockBigQueryQuery,
    mockGetCloudTaskQueueDepth,
    mockGetCloudTaskQueueDepthForQueue,
    mockEnqueueSportsLibReparseHeavyTask,
    mockGetAll,
    mockRecursiveDelete,
    mockRunTransaction,
    mockTransactionGet,
    mockTransactionSet,
} = vi.hoisted(() => {
    const mockListUsers = vi.fn();
    const mockCreateCustomToken = vi.fn();
    const mockGetUser = vi.fn();
    const mockAuth = { listUsers: mockListUsers, createCustomToken: mockCreateCustomToken, getUser: mockGetUser };
    const mockOnCall = vi.fn((_options: unknown, handler: unknown) => handler);

    const mockCollection = vi.fn() as any;
    const mockDoc = vi.fn();
    const mockGetAll = vi.fn();
    const mockRecursiveDelete = vi.fn().mockResolvedValue(undefined);
    const mockTransactionGet = vi.fn(async (ref: any) => {
        if (typeof ref?.get === 'function') {
            return ref.get();
        }
        const path = `${ref?.path || ''}`;
        if (path.startsWith('users/')) {
            return { exists: true, data: () => ({}) };
        }
        if (path.startsWith('userDeletionTombstones/')) {
            return { exists: false, data: () => undefined };
        }
        return { exists: false, data: () => undefined };
    });
    const mockTransactionSet = vi.fn(async (ref: any, payload: Record<string, unknown>, options?: Record<string, unknown>) => {
        if (typeof ref?.set === 'function') {
            return ref.set(payload, options);
        }
        return undefined;
    });
    const mockRunTransaction = vi.fn(async (callback: any) => callback({
        get: mockTransactionGet,
        set: mockTransactionSet,
    }));
    const mockFirestore = vi.fn(() => ({
        collection: mockCollection,
        collectionGroup: mockCollection,
        doc: mockDoc,
        getAll: mockGetAll,
        recursiveDelete: mockRecursiveDelete,
        runTransaction: mockRunTransaction,
    }));

    const mockRemoteConfig = vi.fn(() => ({
        getTemplate: vi.fn(),
        validateTemplate: vi.fn(),
        publishTemplate: vi.fn(),
    }));

    const mockStripeClient = {
        invoices: {
            list: vi.fn(),
        },
    };

    const mockGetProjectBillingInfo = vi.fn();
    const mockGetBillingAccount = vi.fn();
    const mockListBudgets = vi.fn();
    const mockGetTables = vi.fn();
    const mockBigQueryQuery = vi.fn();
    const mockGetCloudTaskQueueDepth = vi.fn().mockResolvedValue(42);
    const mockEnqueueSportsLibReparseHeavyTask = vi.fn().mockResolvedValue(true);
    const mockGetCloudTaskQueueDepthForQueue = vi.fn(async (queueId: string) => {
        if (queueId === 'processWorkoutTask') {
            return 42;
        }
        if (queueId === 'processActivitySyncTask') {
            return 0;
        }
        if (queueId === 'processSleepSyncTask') {
            return 3;
        }
        if (queueId === 'processSportsLibReparseTask') {
            return 8;
        }
        if (queueId === 'processSportsLibReparseHeavyTask') {
            return 2;
        }
        if (queueId === 'processSportsLibRouteReparseTask') {
            return 1;
        }
        if (queueId === 'processDerivedMetricsTask') {
            return 6;
        }
        return 0;
    });

    return {
        mockListUsers,
        mockCreateCustomToken,
        mockGetUser,
        mockAuth,
        mockOnCall,
        mockCollection,
        mockDoc,
        mockFirestore,
        mockRemoteConfig,
        mockStripeClient,
        mockGetProjectBillingInfo,
        mockGetBillingAccount,
        mockListBudgets,
        mockGetTables,
        mockBigQueryQuery,
        mockGetCloudTaskQueueDepth,
        mockGetCloudTaskQueueDepthForQueue,
        mockEnqueueSportsLibReparseHeavyTask,
        mockGetAll,
        mockRecursiveDelete,
        mockRunTransaction,
        mockTransactionGet,
        mockTransactionSet,
    };
});

mockAuth.listUsers = mockListUsers;
mockAuth.createCustomToken = mockCreateCustomToken;
mockAuth.getUser = mockGetUser;

vi.mock('../../stripe/client', () => ({
    getStripe: vi.fn().mockResolvedValue(mockStripeClient),
}));

vi.mock('@google-cloud/billing', () => ({
    CloudBillingClient: vi.fn(() => ({
        getProjectBillingInfo: mockGetProjectBillingInfo,
        getBillingAccount: mockGetBillingAccount,
    })),
}));

vi.mock('@google-cloud/billing-budgets', () => ({
    BudgetServiceClient: vi.fn(() => ({
        listBudgets: mockListBudgets,
    })),
}));

vi.mock('@google-cloud/bigquery', () => ({
    BigQuery: vi.fn(() => ({
        dataset: vi.fn(() => ({
            getTables: mockGetTables,
        })),
        query: mockBigQueryQuery,
    })),
}));

vi.mock('firebase-admin', () => {
    const firestoreMock: any = mockFirestore;
    firestoreMock.FieldValue = {
        serverTimestamp: vi.fn().mockReturnValue('mock-timestamp'),
        delete: vi.fn().mockReturnValue('mock-delete'),
    };
    firestoreMock.FieldPath = {
        documentId: vi.fn(() => '__name__'),
    };

    return {
        auth: () => mockAuth,
        initializeApp: vi.fn(),
        apps: { length: 1 },
        firestore: firestoreMock,
        remoteConfig: mockRemoteConfig,
    };
});

vi.mock('firebase-functions/v2/https', () => ({
    onCall: mockOnCall,
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

vi.mock('../../utils', () => ({
    ALLOWED_CORS_ORIGINS: ['*'],
    getCloudTaskQueueDepth: mockGetCloudTaskQueueDepth,
    getCloudTaskQueueDepthForQueue: mockGetCloudTaskQueueDepthForQueue,
    enforceAppCheck: vi.fn(),
}));

vi.mock('../../shared/cloud-tasks', () => ({
    enqueueSportsLibReparseHeavyTask: mockEnqueueSportsLibReparseHeavyTask,
}));

vi.mock('../../config', () => ({
    config: {
        cloudtasks: {
            workoutQueue: 'processWorkoutTask',
            activitySyncQueue: 'processActivitySyncTask',
            sleepSyncQueue: 'processSleepSyncTask',
            sportsLibReparseQueue: 'processSportsLibReparseTask',
            sportsLibReparseHeavyQueue: 'processSportsLibReparseHeavyTask',
            sportsLibRouteReparseQueue: 'processSportsLibRouteReparseTask',
            derivedMetricsQueue: 'processDerivedMetricsTask',
            queue: 'processWorkoutTask',
        },
    },
}));

export {
    mockListUsers,
    mockCreateCustomToken,
    mockGetUser,
    mockAuth,
    mockOnCall,
    mockCollection,
    mockDoc,
    mockFirestore,
    mockRemoteConfig,
    mockStripeClient,
    mockGetProjectBillingInfo,
    mockGetBillingAccount,
    mockListBudgets,
    mockGetTables,
    mockBigQueryQuery,
    mockGetCloudTaskQueueDepth,
    mockGetCloudTaskQueueDepthForQueue,
    mockEnqueueSportsLibReparseHeavyTask,
    mockGetAll,
    mockRecursiveDelete,
    mockRunTransaction,
    mockTransactionGet,
    mockTransactionSet,
};

const adminHandlers = await import('../index');

export const {
    listUsers,
    getQueueStats,
    retrySportsLibReparseHeavyJob,
    getUserCount,
    getSubscriptionHistoryTrend,
    getUserGrowthTrend,
    getMaintenanceStatus,
    setMaintenanceMode,
    impersonateUser,
    stopImpersonation,
    getFinancialStats,
} = adminHandlers;

export const getAdminRequest = <T = Record<string, unknown>>(data: T = {} as T) => ({
    data,
    auth: { uid: 'admin', token: { admin: true } },
    app: { appId: 'test-app' },
} as unknown as CallableRequest<T>);
