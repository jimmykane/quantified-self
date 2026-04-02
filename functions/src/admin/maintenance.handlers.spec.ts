import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CallableRequest } from 'firebase-functions/v2/https';
import {
    getAdminRequest,
    getMaintenanceStatus,
    setMaintenanceMode,
    mockRemoteConfig,
} from './test-utils/admin-test-harness.spec';

describe('getMaintenanceStatus Cloud Function', () => {
    let request: any;

    beforeEach(() => {
        vi.clearAllMocks();
        request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            },
            app: { appId: 'mock-app-id' }
        };

        // Reset Remote Config mock with parameterGroups structure
        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue({
                parameterGroups: {
                    maintenance: {
                        parameters: {
                            prod_enabled: { defaultValue: { value: 'true' } },
                            prod_message: { defaultValue: { value: 'RC Prod Msg' } },
                            beta_enabled: { defaultValue: { value: 'false' } },
                            beta_message: { defaultValue: { value: 'RC Beta Msg' } },
                            dev_enabled: { defaultValue: { value: 'false' } },
                            dev_message: { defaultValue: { value: 'RC Dev Msg' } }
                        }
                    }
                }
            })
        });
    });

    it('should return status for all environments from Remote Config parameterGroups', async () => {
        const result: any = await (getMaintenanceStatus as any)(request);

        expect(result.prod.enabled).toBe(true);
        expect(result.prod.message).toBe('RC Prod Msg');
        expect(result.beta.enabled).toBe(false);
        expect(result.beta.message).toBe('RC Beta Msg');
        expect(result.dev.enabled).toBe(false);
        expect(result.dev.message).toBe('RC Dev Msg');
    });

    it('should return default (off) if parameterGroups is empty or missing', async () => {
        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue({
                parameterGroups: {}
            })
        });

        const result: any = await (getMaintenanceStatus as any)(request);
        expect(result.prod.enabled).toBe(false);
        expect(result.beta.enabled).toBe(false);
        expect(result.dev.enabled).toBe(false);
    });
});

describe('setMaintenanceMode Cloud Function', () => {
    let request: any;

    beforeEach(() => {
        vi.clearAllMocks();
        request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            },
            app: { appId: 'mock-app-id' },
            data: {
                enabled: true,
                message: 'New Maintenance',
                env: 'beta'
            }
        };

        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue({ parameters: {} }),
            validateTemplate: vi.fn().mockResolvedValue({}),
            publishTemplate: vi.fn().mockResolvedValue({})
        });
    });

    it('should update Remote Config with maintenance status and metadata', async () => {
        const template: any = { parameterGroups: {} };
        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue(template),
            validateTemplate: vi.fn(),
            publishTemplate: vi.fn()
        });

        const result: any = await (setMaintenanceMode as any)(request);

        expect(result.success).toBe(true);
        expect(result.enabled).toBe(true);
        expect(result.message).toBe('New Maintenance');
        expect(result.env).toBe('beta');

        // Verify Remote Config parameterGroups update
        expect(template.parameterGroups['maintenance']).toBeDefined();
        const group = template.parameterGroups['maintenance'];
        expect(group.parameters['beta_enabled'].defaultValue.value).toBe('true');
        expect(group.parameters['beta_message'].defaultValue.value).toBe('New Maintenance');
    });


    it('should update parameterGroups when environment is prod', async () => {
        request.data.env = 'prod';
        const template: any = { parameterGroups: {} };
        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue(template),
            validateTemplate: vi.fn(),
            publishTemplate: vi.fn()
        });

        await (setMaintenanceMode as any)(request);

        expect(template.parameterGroups['maintenance']).toBeDefined();
        const group = template.parameterGroups['maintenance'];
        expect(group.parameters['prod_enabled'].defaultValue.value).toBe('true');
    });

    it('should update parameterGroups when environment is beta', async () => {
        request.data.env = 'beta';
        const template: any = { parameterGroups: {} };
        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue(template),
            validateTemplate: vi.fn(),
            publishTemplate: vi.fn()
        });

        await (setMaintenanceMode as any)(request);

        expect(template.parameterGroups['maintenance']).toBeDefined();
        const group = template.parameterGroups['maintenance'];
        expect(group.parameters['beta_enabled'].defaultValue.value).toBe('true');
    });
});

