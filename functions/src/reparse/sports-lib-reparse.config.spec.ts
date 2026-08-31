import { describe, expect, it } from 'vitest';
import {
    resolveSportsLibReparseRuntimeSettings,
    validateSportsLibReparseTargetUid,
} from './sports-lib-reparse.config';

describe('sports-lib reparse runtime settings', () => {
    it('uses the fail-safe compile-time defaults when persisted settings are absent', () => {
        const settings = resolveSportsLibReparseRuntimeSettings(undefined);

        expect(settings).toEqual(expect.objectContaining({
            enabled: false,
            targetUid: null,
            uidAllowlist: null,
            source: 'defaults',
            configurationValid: true,
        }));
    });

    it('resolves an enabled targeted scan from persisted settings', () => {
        const settings = resolveSportsLibReparseRuntimeSettings({
            runtimeSettings: {
                enabled: true,
                targetUid: ' user-123 ',
                updatedAt: 'timestamp',
                updatedBy: 'admin-1',
            },
        });

        expect(settings.enabled).toBe(true);
        expect(settings.targetUid).toBe('user-123');
        expect(Array.from(settings.uidAllowlist || [])).toEqual(['user-123']);
        expect(settings.source).toBe('firestore');
        expect(settings.configurationValid).toBe(true);
        expect(settings.updatedAt).toBe('timestamp');
        expect(settings.updatedBy).toBe('admin-1');
    });

    it('resolves a blank target as an explicit global scan', () => {
        const settings = resolveSportsLibReparseRuntimeSettings({
            runtimeSettings: { enabled: true, targetUid: '   ' },
        });

        expect(settings.enabled).toBe(true);
        expect(settings.targetUid).toBeNull();
        expect(settings.uidAllowlist).toBeNull();
        expect(settings.configurationValid).toBe(true);
    });

    it('retains a valid target while the scanner is disabled', () => {
        const settings = resolveSportsLibReparseRuntimeSettings({
            runtimeSettings: { enabled: false, targetUid: 'user-123' },
        });

        expect(settings.enabled).toBe(false);
        expect(settings.targetUid).toBe('user-123');
        expect(Array.from(settings.uidAllowlist || [])).toEqual(['user-123']);
    });

    it.each([
        { enabled: 'true', targetUid: null },
        { enabled: true },
        { enabled: true, targetUid: 'invalid/user' },
        { enabled: true, targetUid: 123 },
        null,
        [],
    ])('fails closed for malformed persisted settings: %j', (runtimeSettings) => {
        const settings = resolveSportsLibReparseRuntimeSettings({ runtimeSettings });

        expect(settings.enabled).toBe(false);
        expect(settings.configurationValid).toBe(false);
        expect(settings.uidAllowlist).toBeNull();
        expect(settings.source).toBe('firestore');
    });

    it('validates Firebase UID input bounds and path safety', () => {
        expect(validateSportsLibReparseTargetUid(null)).toEqual({ valid: true, targetUid: null });
        expect(validateSportsLibReparseTargetUid(' user ')).toEqual({ valid: true, targetUid: 'user' });
        expect(validateSportsLibReparseTargetUid('a'.repeat(129)).valid).toBe(false);
        expect(validateSportsLibReparseTargetUid('users/example').valid).toBe(false);
        expect(validateSportsLibReparseTargetUid('user\u0000id').valid).toBe(false);
    });
});
