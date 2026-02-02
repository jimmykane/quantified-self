import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted admin mock & dotenv noop
const adminMock = vi.hoisted(() => ({
    instanceId: vi.fn(() => ({
        app: { options: { projectId: 'mock-project' } }
    }))
}));

vi.mock('dotenv', () => ({ config: vi.fn() }));

vi.mock('firebase-admin', () => ({
    default: {
        instanceId: adminMock.instanceId
    },
    instanceId: adminMock.instanceId
}));

const envBackup: NodeJS.ProcessEnv = { ...process.env };

describe('config.ts', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.assign(process.env, {
            SUUNTOAPP_CLIENT_ID: 'suunto-id',
            SUUNTOAPP_CLIENT_SECRET: 'suunto-secret',
            SUUNTOAPP_SUBSCRIPTION_KEY: 'suunto-sub',
            COROSAPI_CLIENT_ID: 'coros-id',
            COROSAPI_CLIENT_SECRET: 'coros-secret',
            GARMINAPI_CLIENT_ID: 'garmin-id',
            GARMINAPI_CLIENT_SECRET: 'garmin-secret',
        });
        delete process.env.GCLOUD_PROJECT; // force fallback to admin.instanceId
    });

    afterEach(() => {
        process.env = { ...envBackup };
        vi.clearAllMocks();
    });

    it('returns configured values and derives cloudtasks defaults from admin project', async () => {
        const { config } = await import('./config');

        expect(config.suuntoapp.client_id).toBe('suunto-id');
        expect(config.suuntoapp.subscription_key).toBe('suunto-sub');
        expect(config.corosapi.client_secret).toBe('coros-secret');
        expect(config.garminapi.client_id).toBe('garmin-id');

        expect(config.cloudtasks.projectId).toBe('mock-project');
        expect(config.cloudtasks.serviceAccountEmail).toBe('mock-project@appspot.gserviceaccount.com');
        expect(config.debug.bucketName).toBe('quantified-self-io-debug-files');
    });

    it('throws when a required env var is missing', async () => {
        delete process.env.SUUNTOAPP_CLIENT_ID;
        const { config } = await import('./config');

        expect(() => config.suuntoapp.client_id).toThrow(/Missing required environment variable: SUUNTOAPP_CLIENT_ID/);
    });
});
