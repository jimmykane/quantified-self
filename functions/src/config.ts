import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import { FUNCTIONS_MANIFEST, SPORTS_LIB_REPARSE_HEAVY_TASK_FUNCTION_NAME } from '../../shared/functions-manifest';

// Load .env file automatically for local development
dotenv.config();

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
            client_id: getEnvVar('SUUNTOAPP_CLIENT_ID'),
            client_secret: getEnvVar('SUUNTOAPP_CLIENT_SECRET'),
            subscription_key: getEnvVar('SUUNTOAPP_SUBSCRIPTION_KEY'),
        };
    },
    get corosapi() {
        return {
            client_id: getEnvVar('COROSAPI_CLIENT_ID'),
            client_secret: getEnvVar('COROSAPI_CLIENT_SECRET'),
        };
    },
    get garminapi() {
        return {
            client_id: getEnvVar('GARMINAPI_CLIENT_ID'),
            client_secret: getEnvVar('GARMINAPI_CLIENT_SECRET'),
        };
    },
    get wahooapi() {
        return {
            client_id: getEnvVar('WAHOOAPI_CLIENT_ID'),
            client_secret: getEnvVar('WAHOOAPI_CLIENT_SECRET'),
            webhook_token: getEnvVar('WAHOOAPI_WEBHOOK_TOKEN'),
            allowed_file_hosts: (process.env.WAHOOAPI_ALLOWED_FILE_HOSTS || 'cdn.wahooligan.com')
                .split(',')
                .map((host) => host.trim().toLowerCase())
                .filter(Boolean),
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
