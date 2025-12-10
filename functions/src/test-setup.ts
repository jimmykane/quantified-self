import { vi } from 'vitest';

// Set environment variables that Firebase expects FIRST
process.env.GCLOUD_PROJECT = 'test-project';
process.env.FIREBASE_CONFIG = JSON.stringify({
    projectId: 'test-project',
    databaseURL: 'https://test-project.firebaseio.com',
});

// Use vi.hoisted to create config that's available to mocks
const mockConfig = vi.hoisted(() => ({
    suuntoapp: {
        client_id: 'test-suunto-client-id',
        client_secret: 'test-suunto-client-secret',
        subscription_key: 'test-suunto-subscription-key',
    },
    corosapi: {
        client_id: 'test-coros-client-id',
        client_secret: 'test-coros-client-secret',
    },
    garminhealth: {
        consumer_key: 'test-garmin-consumer-key',
        consumer_secret: 'test-garmin-consumer-secret',
    },
}));

// Mock firebase-functions - this will be hoisted
vi.mock('firebase-functions', () => {
    const config = () => ({
        suuntoapp: {
            client_id: 'test-suunto-client-id',
            client_secret: 'test-suunto-client-secret',
            subscription_key: 'test-suunto-subscription-key',
        },
        corosapi: {
            client_id: 'test-coros-client-id',
            client_secret: 'test-coros-client-secret',
        },
        garminhealth: {
            consumer_key: 'test-garmin-consumer-key',
            consumer_secret: 'test-garmin-consumer-secret',
        },
    });

    const regionFn = () => ({
        https: { onRequest: () => { } },
        runWith: () => ({
            https: { onRequest: () => { } },
            pubsub: {
                schedule: () => ({
                    onRun: () => { },
                }),
            },
        }),
    });

    return {
        default: {
            config,
            region: regionFn,
        },
        config,
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
        where: function() {
 return this;
},
        limit: function() {
 return this;
},
    };

    const mockFirestore = () => ({
        collection: () => mockCollection,
        collectionGroup: () => mockCollection,
    });

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
