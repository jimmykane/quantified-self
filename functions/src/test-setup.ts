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
process.env.GARMINAPI_CLIENT_ID = 'test-garmin-client-id';
process.env.GARMINAPI_CLIENT_SECRET = 'test-garmin-consumer-secret';
process.env.WAHOOAPI_CLIENT_ID = 'test-wahoo-client-id';
process.env.WAHOOAPI_CLIENT_SECRET = 'test-wahoo-client-secret';
process.env.WAHOOAPI_WEBHOOK_TOKEN = 'test-wahoo-webhook-token';

// Mock firebase-functions - this will be hoisted
vi.mock('firebase-functions/v1', () => {
    const returnHandler = <Handler>(handler: Handler): Handler => handler;
    const regionFn = () => ({
        https: { onRequest: returnHandler },
        runWith: () => ({
            https: { onRequest: returnHandler },
            pubsub: {
                schedule: () => ({
                    onRun: returnHandler,
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
        constructor() { }
        authorizeURL() {
            return 'https://mock-auth-url.com';
        }
        getToken() {
            return Promise.resolve({ token: {} });
        }
        createToken(token: unknown) {
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
    // Keep all production exports available by default. Individual fixtures
    // below intentionally replace only the broad activity constants that tests
    // need to stay lightweight; route parsing/export remains real.
    ...actual,
    ActivityTypes: {
        Cycling: 'Cycling',
        Biking: 'Cycling',
        EBiking: 'E-Biking',
        EnduroMTB: 'Enduro MTB',
        'Enduro MTB': 'Enduro MTB',
        MountainBiking: 'Mountain Biking',
        DownhillCycling: 'Downhill Cycling',
        Running: 'Running',
        VirtualRunning: 'Virtual Running',
        Walking: 'Walking',
        NordicWalking: 'Nordic Walking',
        Trekking: 'Trekking',
        Swimming: 'Swimming',
        Triathlon: 'Triathlon',
        Multisport: 'Multisport',
        Hiking: 'Hiking',
        TrailRunning: 'Trail Running',
        Treadmill: 'Treadmill',
        IndoorRunning: 'Indoor Running',
        IndoorTraining: 'Indoor Training',
        IndoorCycling: 'Indoor Cycling',
        IndoorClimbing: 'Indoor Climbing',
        Diving: 'Diving',
        ScubaDiving: 'Scuba Diving',
        FreeDiving: 'Free Diving',
        Snorkeling: 'Snorkeling',
        Mermaiding: 'Mermaiding',
        Yoga: 'Yoga',
        Pilates: 'Pilates',
        FlexibilityTraining: 'Flexibility Training',
        Stretching: 'Stretching',
        Gymnastics: 'Gymnastics',
        Training: 'Training',
        Workout: 'Workout',
        Generic: 'Generic',
        HIIT: 'HIIT',
        Aerobics: 'Aerobics',
        Crosstrainer: 'Crosstrainer',
        FitnessEquipment: 'Fitness Equipment',
        CardioTraining: 'Cardio Training',
        CircuitTraining: 'Circuit Training',
        EllipticalTrainer: 'Elliptical Trainer',
        StairStepper: 'Stair Stepper',
        Other: 'Other',
        Aquathlon: 'Aquathlon',
        Duathlon: 'Duathlon',
        Swimrun: 'Swimrun',
        Transition: 'Transition',
        Route: 'Route',
        Rowing: 'Rowing',
        IndoorRowing: 'Indoor Rowing',
        Kayaking: 'Kayaking',
        Canoeing: 'Canoeing',
        Paddling: 'Paddling',
        StandUpPaddling: 'Stand Up Paddling',
        Sailing: 'Sailing',
        Surfing: 'Surfing',
        OpenWaterSwimming: 'Open Water Swimming',
        VirtualCycling: 'Virtual Cycling',
        CrosscountrySkiing: 'Crosscountry Skiing',
        NordicSki: 'Nordic Skiing',
        RollerSki: 'Roller Skiing',
        SkiTouring: 'Ski Touring',
        BackCountrySkiing: 'Backcountry Skiing',
        Snowshoeing: 'Snowshoeing',
        Crossfit: 'Crossfit',
        StrengthTraining: 'Strength Training',
        WeightTraining: 'Weight Training',
        Kettlebell: 'Kettlebell',
        'Weight Training': 'Weight Training',
        'Indoor Training': 'Indoor Training',
        'Fitness Equipment': 'Fitness Equipment',
        'Cardio Training': 'Cardio Training',
        'Circuit Training': 'Circuit Training',
        'Elliptical Trainer': 'Elliptical Trainer',
        'Stair Stepper': 'Stair Stepper',
        'Flexibility Training': 'Flexibility Training',
        'Mountain Biking': 'Mountain Biking',
    },
    ActivityTypeGroups: {
        CyclingGroup: 'cycling_group',
        MountainBikingGroup: 'mountain_biking_group',
        RunningGroup: 'running_group',
        TrailRunningGroup: 'trail_running_group',
        SwimmingGroup: 'swimming_group',
        DivingGroup: 'diving_group',
        UnspecifiedGroup: 'unspecified_group',
        WaterSportsGroup: 'water_sports_group',
    },
    ActivityTypesHelper: {
        resolveActivityType: actual.ActivityTypesHelper.resolveActivityType.bind(actual.ActivityTypesHelper),
        getActivityTypeGroupsAsUniqueArray: () => [
            'cycling_group',
            'mountain_biking_group',
            'running_group',
            'trail_running_group',
            'swimming_group',
            'unspecified_group',
            'water_sports_group',
        ],
        getActivityTypesAsUniqueArray:
            actual.ActivityTypesHelper.getActivityTypesAsUniqueArray.bind(
                actual.ActivityTypesHelper,
            ),
        getActivityGroupForActivityType: (activityType: string) => {
            const resolvedActivityType = actual.ActivityTypesHelper
                .resolveActivityType(activityType);
            if (!resolvedActivityType) {
                throw new Error('Unknown activity type.');
            }
            return actual.ActivityTypesHelper.getActivityGroupForActivityType(
                resolvedActivityType,
            );
        },
        speedDerivedDataTypesToUseForActivityType:
            actual.ActivityTypesHelper.speedDerivedDataTypesToUseForActivityType.bind(
                actual.ActivityTypesHelper,
            ),
        altiDistanceSpeedDerivedDataTypesToUseForActivityType:
            actual.ActivityTypesHelper.altiDistanceSpeedDerivedDataTypesToUseForActivityType.bind(
                actual.ActivityTypesHelper,
            ),
        isIndoorActivityType:
            actual.ActivityTypesHelper.isIndoorActivityType.bind(
                actual.ActivityTypesHelper,
            ),
        usesStrokeRate:
            actual.ActivityTypesHelper.usesStrokeRate.bind(
                actual.ActivityTypesHelper,
            ),
        shouldExcludeAscent:
            actual.ActivityTypesHelper.shouldExcludeAscent.bind(
                actual.ActivityTypesHelper,
            ),
        shouldExcludeDescent:
            actual.ActivityTypesHelper.shouldExcludeDescent.bind(
                actual.ActivityTypesHelper,
            ),
        shouldExcludeTerrainSummaryMetrics:
            actual.ActivityTypesHelper.shouldExcludeTerrainSummaryMetrics.bind(
                actual.ActivityTypesHelper,
            ),
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
                case 'diving_group':
                    return ['Diving', 'Scuba Diving', 'Free Diving', 'Snorkeling', 'Mermaiding'];
                default:
                    return [];
            }
        },
    },
    DataActivityTypes: { type: 'Activity Types' },
    DataAscent: { type: 'Ascent' },
    DataCriticalPower: { type: 'Critical Power' },
    DataDescent: { type: 'Descent' },
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
    // DataSwimDistance intentionally shares the canonical Distance stat key in
    // sports-lib. Keep the mock aligned so shared metric registries are tested
    // against the same persisted shape as production.
    DataSwimDistance: { type: actual.DataSwimDistance.type },
    DataSwimPaceAvg: { type: 'Average Swim Pace' },
    // Manual Health writes validate VO2 max with the real canonical class.
    DataVO2Max: actual.DataVO2Max,
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
        buildRouteFilePreview: (routeFile: unknown) => {
            const routeFileRecord = routeFile && typeof routeFile === 'object'
                ? routeFile as { routes?: unknown; toJSON?: () => unknown }
                : {};
            const serializedRouteFile = typeof routeFileRecord.toJSON === 'function'
                ? routeFileRecord.toJSON()
                : null;
            const serializedRoutes = serializedRouteFile && typeof serializedRouteFile === 'object'
                ? (serializedRouteFile as { routes?: unknown }).routes
                : undefined;
            const routes: unknown[] = Array.isArray(routeFileRecord.routes)
                ? routeFileRecord.routes
                : Array.isArray(serializedRoutes)
                    ? serializedRoutes
                    : [];
            const segments = routes
                .map((routeValue, index) => {
                    const route = routeValue && typeof routeValue === 'object'
                        ? routeValue as Record<string, unknown>
                        : {};
                    const routePoints = Array.isArray(route.points) ? route.points : [];
                    const points = routePoints
                        .filter((pointValue): pointValue is Record<string, unknown> => (
                            !!pointValue
                            && typeof pointValue === 'object'
                            && Number.isFinite((pointValue as Record<string, unknown>).latitudeDegrees)
                            && Number.isFinite((pointValue as Record<string, unknown>).longitudeDegrees)
                            && (
                                (pointValue as Record<string, unknown>).latitudeDegrees !== 0
                                || (pointValue as Record<string, unknown>).longitudeDegrees !== 0
                            )
                        ))
                    if (points.length < 2) {
                        return null;
                    }
                    return {
                        id: typeof route.id === 'string' && route.id ? route.id : `segment-${index}`,
                        name: route.name ?? null,
                        activityType: route.activityType ?? null,
                        sourcePointCount: routePoints.length,
                        pointCount: points.length,
                        encodedPolyline: 'mock-polyline',
                    };
                })
                .filter((segment): segment is NonNullable<typeof segment> => segment !== null);
            if (!segments.length) {
                return null;
            }
            return {
                version: 1,
                encoding: 'polyline5',
                precision: 5,
                sourcePointCount: segments.reduce((sum, segment) => sum + segment.sourcePointCount, 0),
                pointCount: segments.reduce((sum, segment) => sum + segment.pointCount, 0),
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
