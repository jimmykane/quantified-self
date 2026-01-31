import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';

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

interface CloudTasksConfig {
    projectId: string | undefined;
    location: string;
    queue: string;
    serviceAccountEmail: string;
}

interface DebugConfig {
    bucketName: string;
}

interface AppConfig {
    suuntoapp: SuuntoAppConfig;
    corosapi: CorosApiConfig;
    garminapi: GarminApiConfig;
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
    get cloudtasks() {
        return {
            projectId: process.env.GCLOUD_PROJECT || admin.instanceId().app.options.projectId,
            location: 'europe-west2',
            queue: 'processWorkoutTask',
            serviceAccountEmail: `${process.env.GCLOUD_PROJECT || admin.instanceId().app.options.projectId}@appspot.gserviceaccount.com`,
        };
    },
    get debug() {
        return {
            bucketName: 'quantified-self-io-debug-files',
        };
    },
};
