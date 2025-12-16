/**
 * Centralized configuration module
 * Replaces deprecated functions.config() calls with process.env
 *
 * Firebase Functions automatically loads .env files at runtime.
 * For local development/testing, ensure environment variables are set.
 */

interface SuuntoAppConfig {
    client_id: string;
    client_secret: string;
    subscription_key: string;
}

interface CorosApiConfig {
    client_id: string;
    client_secret: string;
}

interface GarminHealthApiConfig {
    consumer_key: string;
    consumer_secret: string;
}

interface AppConfig {
    suuntoapp: SuuntoAppConfig;
    corosapi: CorosApiConfig;
    garminhealthapi: GarminHealthApiConfig;
}

function getEnvVar(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export const config: AppConfig = {
    suuntoapp: {
        client_id: getEnvVar('SUUNTOAPP_CLIENT_ID'),
        client_secret: getEnvVar('SUUNTOAPP_CLIENT_SECRET'),
        subscription_key: getEnvVar('SUUNTOAPP_SUBSCRIPTION_KEY'),
    },
    corosapi: {
        client_id: getEnvVar('COROSAPI_CLIENT_ID'),
        client_secret: getEnvVar('COROSAPI_CLIENT_SECRET'),
    },
    garminhealthapi: {
        consumer_key: getEnvVar('GARMINHEALTHAPI_CONSUMER_KEY'),
        consumer_secret: getEnvVar('GARMINHEALTHAPI_CONSUMER_SECRET'),
    },
};
