import * as admin from 'firebase-admin';
import { FUNCTIONS_MANIFEST, SPORTS_LIB_REPARSE_HEAVY_TASK_FUNCTION_NAME } from '../../shared/functions-manifest';

interface SuuntoAppConfig {
    client_id: string;
    client_secret: string;
    subscription_key: string;
}

interface CorosApiConfig {
    client_id: string;
    client_secret: string;
}

interface GarminApiConfig {
    client_id: string;
    client_secret: string;
}

interface WahooApiConfig {
    client_id: string;
    client_secret: string;
    webhook_token: string;
    allowed_file_hosts: string[];
}

interface CloudTasksConfig {
    projectId: string | undefined;
    location: string;
    workoutQueue: string;
    routeSyncQueue: string;
    routeDeliverySyncQueue: string;
    activitySyncQueue: string;
    sleepSyncQueue: string;
    garminHealthBackfillQueue: string;
    sportsLibReparseQueue: string;
    sportsLibReparseHeavyQueue: string;
    sportsLibRouteReparseQueue: string;
    derivedMetricsIngressQueue: string;
    derivedMetricsQueue: string;
    derivedMetricsIngressBucketSeconds: number;
}

interface DebugConfig {
    bucketName: string;
}

interface AppConfig {
    suuntoapp: SuuntoAppConfig;
    corosapi: CorosApiConfig;
    garminapi: GarminApiConfig;
    wahooapi: WahooApiConfig;
    cloudtasks: CloudTasksConfig;
    debug: DebugConfig;
}

function getEnvVar(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export const config: AppConfig = {

    get suuntoapp() {
        return {
            get client_id() {
                return getEnvVar('SUUNTOAPP_CLIENT_ID');
            },
            get client_secret() {
                return getEnvVar('SUUNTOAPP_CLIENT_SECRET');
            },
            get subscription_key() {
                return getEnvVar('SUUNTOAPP_SUBSCRIPTION_KEY');
            },
        };
    },
    get corosapi() {
        return {
            get client_id() {
                return getEnvVar('COROSAPI_CLIENT_ID');
            },
            get client_secret() {
                return getEnvVar('COROSAPI_CLIENT_SECRET');
            },
        };
    },
    get garminapi() {
        return {
            get client_id() {
                return getEnvVar('GARMINAPI_CLIENT_ID');
            },
            get client_secret() {
                return getEnvVar('GARMINAPI_CLIENT_SECRET');
            },
        };
    },
    get wahooapi() {
        return {
            get client_id() {
                return getEnvVar('WAHOOAPI_CLIENT_ID');
            },
            get client_secret() {
                return getEnvVar('WAHOOAPI_CLIENT_SECRET');
            },
            get webhook_token() {
                return getEnvVar('WAHOOAPI_WEBHOOK_TOKEN');
            },
            get allowed_file_hosts() {
                return (process.env.WAHOOAPI_ALLOWED_FILE_HOSTS || 'cdn.wahooligan.com')
                    .split(',')
                    .map((host) => host.trim().toLowerCase())
                    .filter(Boolean);
            },
        };
    },
    get cloudtasks() {
        return {
            projectId: process.env.GCLOUD_PROJECT || admin.instanceId().app.options.projectId,
            location: 'europe-west2',
            workoutQueue: 'processWorkoutTask',
            routeSyncQueue: 'processRouteSyncTask',
            routeDeliverySyncQueue: 'processRouteDeliverySyncTask',
            activitySyncQueue: 'processActivitySyncTask',
            sleepSyncQueue: 'processSleepSyncTask',
            garminHealthBackfillQueue: FUNCTIONS_MANIFEST.processGarminHealthBackfillTask.name,
            sportsLibReparseQueue: 'processSportsLibReparseTask',
            sportsLibReparseHeavyQueue: SPORTS_LIB_REPARSE_HEAVY_TASK_FUNCTION_NAME,
            sportsLibRouteReparseQueue: 'processSportsLibRouteReparseTask',
            derivedMetricsIngressQueue: FUNCTIONS_MANIFEST.processDerivedMetricsIngressTask.name,
            derivedMetricsQueue: 'processDerivedMetricsTask',
            derivedMetricsIngressBucketSeconds: 30,
        };
    },
    get debug() {
        return {
            bucketName: 'quantified-self-io-debug-files',
        };
    },
};
