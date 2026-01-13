import { vi } from 'vitest';

// Set environment variables that Firebase expects FIRST
process.env.GCLOUD_PROJECT = 'test-project';
process.env.FIREBASE_CONFIG = JSON.stringify({
    projectId: 'test-project',
    databaseURL: 'https://test-project.firebaseio.com',
});

// Set environment variables for config module
process.env.SUUNTOAPP_CLIENT_ID = 'test-suunto-client-id';
process.env.SUUNTOAPP_CLIENT_SECRET = 'test-suunto-client-secret';
process.env.SUUNTOAPP_SUBSCRIPTION_KEY = 'test-suunto-subscription-key';
process.env.COROSAPI_CLIENT_ID = 'test-coros-client-id';
process.env.COROSAPI_CLIENT_SECRET = 'test-coros-client-secret';
process.env.GARMINHEALTHAPI_CONSUMER_KEY = 'test-garmin-consumer-key';
process.env.GARMINHEALTHAPI_CONSUMER_SECRET = 'test-garmin-consumer-secret';
process.env.GARMINAPI_CLIENT_ID = 'test-garmin-client-id';
process.env.GARMINAPI_CLIENT_SECRET = 'test-garmin-consumer-secret';

// Mock firebase-functions - this will be hoisted
vi.mock('firebase-functions/v1', () => {
    const regionFn = () => ({
        https: { onRequest: (handler: any) => handler },
        runWith: () => ({
            https: { onRequest: (handler: any) => handler },
            pubsub: {
                schedule: () => ({
                    onRun: (handler: any) => handler,
                }),
            },
        }),
    });

    return {
        default: {
            region: regionFn,
        },
        region: regionFn,
    };
});

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    const mockDocRef = {
        update: () => Promise.resolve(),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        id: 'mock-doc-id',
        get: () => Promise.resolve({ data: () => ({}), exists: true }),
    };

    const mockCollection = {
        doc: () => mockDocRef,
        get: () => Promise.resolve({
            docs: [],
            size: 0,
        }),
        where: function () {
            return this;
        },
        limit: function () {
            return this;
        },
    };

    const mockFirestoreInstance = {
        collection: () => mockCollection,
        collectionGroup: () => mockCollection,
    };

    const mockFirestore = () => mockFirestoreInstance;

    return {
        default: {
            initializeApp: () => { },
            credential: {
                cert: () => { },
            },
            firestore: mockFirestore,
            auth: () => ({
                verifyIdToken: () => { },
                createUser: () => { },
                updateUser: () => { },
                createCustomToken: () => { },
            }),
        },
        firestore: Object.assign(mockFirestore, {
            FieldValue: {
                serverTimestamp: () => { },
                arrayUnion: () => { },
                arrayRemove: () => { },
                delete: () => ({ __delete__: true }),
            },
        }),
        initializeApp: () => { },
        credential: {
            cert: () => { },
        },
        auth: () => ({
            verifyIdToken: () => { },
            createUser: () => { },
            updateUser: () => { },
            createCustomToken: () => { },
        }),
    };
});

// Mock simple-oauth2
vi.mock('simple-oauth2', () => ({
    AuthorizationCode: class MockAuthorizationCode {
        constructor(config: any) { }
        authorizeURL(params: any) {
            return 'https://mock-auth-url.com';
        }
        getToken(params: any) {
            return Promise.resolve({ token: {} });
        }
        createToken(token: any) {
            return {
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
                token,
            };
        }
    },
}));

// Mock request-helper
vi.mock('./request-helper', () => ({
    default: {
        get: () => Promise.resolve({}),
        post: () => Promise.resolve({}),
    },
    get: () => Promise.resolve({}),
    post: () => Promise.resolve({}),
}));

// Mock sports-lib to avoid resolution errors
vi.mock('@sports-alliance/sports-lib', () => ({
    ServiceNames: {
        GarminHealthAPI: 'garminHealthAPI',
        SuuntoApp: 'suuntoApp',
        COROSAPI: 'corosAPI',
    },
    GarminHealthAPIAuth: () => ({
        toHeader: () => ({}),
        authorize: () => ({}),
    }),
}));

// Mock firebase-functions/logger globally
vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    write: vi.fn(),
}));
