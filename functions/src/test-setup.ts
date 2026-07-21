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
process.env.SUUNTOAPP_NOTIFICATION_SECRET = 'test-suunto-notification-secret';
process.env.COROSAPI_CLIENT_ID = 'test-coros-client-id';
process.env.COROSAPI_CLIENT_SECRET = 'test-coros-client-secret';
process.env.GARMINHEALTHAPI_CONSUMER_KEY = 'test-garmin-consumer-key';
process.env.GARMINHEALTHAPI_CONSUMER_SECRET = 'test-garmin-consumer-secret';
process.env.GARMINAPI_CLIENT_ID = 'test-garmin-client-id';
process.env.GARMINAPI_CLIENT_SECRET = 'test-garmin-consumer-secret';
process.env.WAHOOAPI_CLIENT_ID = 'test-wahoo-client-id';
process.env.WAHOOAPI_CLIENT_SECRET = 'test-wahoo-client-secret';
process.env.WAHOOAPI_WEBHOOK_TOKEN = 'test-wahoo-webhook-token';

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
        create: () => Promise.resolve(),
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

// Keep broad sports-lib fixtures lightweight while exercising the real canonical
// durability parser used by production.
vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sports-alliance/sports-lib')>();
    return ({
    ActivityTypes: {
        Cycling: 'Cycling',
        EBiking: 'E-Biking',
        EnduroMTB: 'Enduro MTB',
        MountainBiking: 'Mountain Biking',
        DownhillCycling: 'Downhill Cycling',
        Running: 'Running',
        Walking: 'Walking',
        Swimming: 'Swimming',
        Triathlon: 'Triathlon',
        Hiking: 'Hiking',
        TrailRunning: 'Trail Running',
        Treadmill: 'Treadmill',
        IndoorRunning: 'Indoor Running',
        IndoorTraining: 'Indoor Training',
        IndoorCycling: 'Indoor Cycling',
        IndoorClimbing: 'Indoor Climbing',
        Diving: 'Diving',
        Yoga: 'Yoga',
        Training: 'Training',
        Rowing: 'Rowing',
        Kayaking: 'Kayaking',
        Sailing: 'Sailing',
        OpenWaterSwimming: 'Open Water Swimming',
        VirtualCycling: 'Virtual Cycling',
        'Weight Training': 'Weight Training',
        'Mountain Biking': 'Mountain Biking',
    },
    ActivityTypeGroups: {
        CyclingGroup: 'cycling_group',
        MountainBikingGroup: 'mountain_biking_group',
        RunningGroup: 'running_group',
        TrailRunningGroup: 'trail_running_group',
        SwimmingGroup: 'swimming_group',
    },
    ActivityTypesHelper: {
        getActivityTypesForActivityGroup: (group: string) => {
            switch (group) {
                case 'cycling_group':
                    return ['Cycling', 'Indoor Cycling', 'Virtual Cycling', 'E-Biking'];
                case 'mountain_biking_group':
                    return ['Mountain Biking', 'Enduro MTB', 'Downhill Cycling'];
                case 'running_group':
                    return ['Running', 'Treadmill', 'Indoor Running', 'Virtual Running'];
                case 'trail_running_group':
                    return ['Trail Running'];
                case 'swimming_group':
                    return ['Swimming', 'Open Water Swimming'];
                default:
                    return [];
            }
        },
    },
    DataActivityTypes: { type: 'Activity Types' },
    DataCriticalPower: { type: 'Critical Power' },
    DataDistance: { type: 'Distance' },
    DataDurabilityEvidence: { type: 'Durability Evidence' },
    DataDuration: { type: 'Duration' },
    DataFTP: { type: 'FTP' },
    DataHeartRateAvg: { type: 'Heart Rate Avg' },
    DataHeartRateZoneOneDuration: { type: 'Heart Rate Zone 1 Duration' },
    DataHeartRateZoneTwoDuration: { type: 'Heart Rate Zone 2 Duration' },
    DataHeartRateZoneThreeDuration: { type: 'Heart Rate Zone 3 Duration' },
    DataHeartRateZoneFourDuration: { type: 'Heart Rate Zone 4 Duration' },
    DataHeartRateZoneFiveDuration: { type: 'Heart Rate Zone 5 Duration' },
    DataHeartRateZoneSixDuration: { type: 'Heart Rate Zone 6 Duration' },
    DataHeartRateZoneSevenDuration: { type: 'Heart Rate Zone 7 Duration' },
    DataPowerAvg: { type: 'Power Avg' },
    DataPowerZoneOneDuration: { type: 'Power Zone 1 Duration' },
    DataPowerZoneTwoDuration: { type: 'Power Zone 2 Duration' },
    DataPowerZoneThreeDuration: { type: 'Power Zone 3 Duration' },
    DataPowerZoneFourDuration: { type: 'Power Zone 4 Duration' },
    DataPowerZoneFiveDuration: { type: 'Power Zone 5 Duration' },
    DataPowerZoneSixDuration: { type: 'Power Zone 6 Duration' },
    DataPowerZoneSevenDuration: { type: 'Power Zone 7 Duration' },
    DataRecoveryTime: { type: 'Recovery Time' },
    DataSwimDistance: { type: 'Swim Distance' },
    DataSwimPaceAvg: { type: 'Average Swim Pace' },
    DataVO2Max: { type: 'VO2 Max' },
    DURABILITY_PROTOCOL_VERSION: 1,
    normalizeDurabilityEvidenceValue: actual.normalizeDurabilityEvidenceValue,
    samplePowerCurveAtDuration: (
        points: Array<Record<string, unknown>>,
        duration: number,
        options: { key?: 'power' | 'wattsPerKg'; maximumBracketDurationRatio?: number } = {},
    ) => {
        const key = options.key || 'power';
        const maximumRatio = options.maximumBracketDurationRatio || 1.25;
        const normalized = points
            .map(point => ({ duration: Number(point.duration), value: Number(point[key]) }))
            .filter(point => Number.isFinite(point.duration) && point.duration > 0
                && Number.isFinite(point.value) && point.value > 0)
            .sort((left, right) => left.duration - right.duration);
        const exact = normalized.find(point => point.duration === duration);
        if (exact) {
            return exact.value;
        }
        const rightIndex = normalized.findIndex(point => point.duration > duration);
        if (rightIndex <= 0) {
            return null;
        }
        const left = normalized[rightIndex - 1];
        const right = normalized[rightIndex];
        if ((right.duration / left.duration) > maximumRatio) {
            return null;
        }
        const ratio = ((1 / duration) - (1 / left.duration)) / ((1 / right.duration) - (1 / left.duration));
        return left.value + ((right.value - left.value) * ratio);
    },
    RoutePreviewUtilities: {
        buildRouteFilePreview: (routeFile: any) => {
            const routes = Array.isArray(routeFile?.routes)
                ? routeFile.routes
                : Array.isArray(routeFile?.toJSON?.()?.routes)
                    ? routeFile.toJSON().routes
                    : [];
            const segments = routes
                .map((route: any, index: number) => {
                    const points = Array.isArray(route?.points)
                        ? route.points.filter((point: any) => (
                            Number.isFinite(point?.latitudeDegrees)
                            && Number.isFinite(point?.longitudeDegrees)
                            && (point.latitudeDegrees !== 0 || point.longitudeDegrees !== 0)
                        ))
                        : [];
                    if (points.length < 2) {
                        return null;
                    }
                    return {
                        id: route.id || `segment-${index}`,
                        name: route.name ?? null,
                        activityType: route.activityType ?? null,
                        sourcePointCount: Array.isArray(route?.points) ? route.points.length : points.length,
                        pointCount: points.length,
                        encodedPolyline: 'mock-polyline',
                    };
                })
                .filter(Boolean);
            if (!segments.length) {
                return null;
            }
            return {
                version: 1,
                encoding: 'polyline5',
                precision: 5,
                sourcePointCount: segments.reduce((sum: number, segment: any) => sum + segment.sourcePointCount, 0),
                pointCount: segments.reduce((sum: number, segment: any) => sum + segment.pointCount, 0),
                segments,
            };
        },
    },
    ServiceNames: {
        GarminAPI: 'garminAPI',
        SuuntoApp: 'suuntoApp',
        COROSAPI: 'corosAPI',
        WahooAPI: 'wahooAPI',
    },
    WahooAPIEventMetaData: actual.WahooAPIEventMetaData,
    GarminAPIAuth: () => ({
        toHeader: () => ({}),
        authorize: () => ({}),
    }),
    });
});

// Mock firebase-functions/logger globally
vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    write: vi.fn(),
}));
