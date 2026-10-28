import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoggerService } from './logger.service';
import * as Sentry from '@sentry/browser';
import { environment } from '../../environments/environment';
import type { AppEnvironment } from '../../environments/environment.interface';

// Mock Sentry
vi.mock('@sentry/browser', () => ({
    captureException: vi.fn(),
    getIsolationScope: vi.fn(),
}));

describe('LoggerService', () => {
    let service: LoggerService;

    beforeEach(() => {
        (environment as AppEnvironment).observabilityEnabled = true;
        vi.clearAllMocks();
        service = new LoggerService();
        // Mock console methods
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        (environment as AppEnvironment).observabilityEnabled = false;
    });

    it('should log regular errors to console and Sentry', () => {
        const testError = new Error('Regular error');
        service.error('Error occurred', testError);

        expect(console.error).toHaveBeenCalled();
        expect(Sentry.captureException).toHaveBeenCalledWith(testError);
    });

    it('returns a snapshot of the existing Sentry user without changing the shared scope', () => {
        const user = { id: 'account-a', email: 'test@example.com' };
        vi.mocked(Sentry.getIsolationScope).mockReturnValue({ getUser: () => user } as ReturnType<typeof Sentry.getIsolationScope>);
        const snapshot = service.getUser();
        expect(snapshot).toEqual(user);
        expect(snapshot).not.toBe(user);
        user.id = 'account-b';
        expect(snapshot.id).toBe('account-a');
    });

    it('reads the scope used by the installed SDK for Sentry.setUser', async () => {
        const sdk = await vi.importActual<typeof Sentry>('@sentry/browser');
        const previousUser = { ...sdk.getIsolationScope().getUser() };
        vi.mocked(Sentry.getIsolationScope).mockReturnValue(sdk.getIsolationScope());
        try {
            sdk.setUser({ id: 'account-a' });
            expect(service.getUser()).toEqual({ id: 'account-a' });
            sdk.setUser(null);
            expect(service.getUser()).toEqual({});
        } finally {
            sdk.setUser(previousUser);
        }
    });

    it('should MUTE "Firestore shutting down" errors', () => {
        const shutdownError = new Error('FirebaseError: Firestore shutting down');
        service.error('Some context', shutdownError);

        expect(console.error).not.toHaveBeenCalled();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should MUTE errors even if the message is in the strings around the error object', () => {
        service.error('Firestore shutting down', { some: 'info' });

        expect(console.error).not.toHaveBeenCalled();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should MUTE "The client has already been terminated" errors', () => {
        const terminatedError = new Error('FirebaseError: The client has already been terminated.');
        service.error('Some context', terminatedError);

        expect(console.error).not.toHaveBeenCalled();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should NOT mute errors that just happen to contain similar words', () => {
        service.error('Firestore is up', new Error('Not shutting down'));

        expect(console.error).toHaveBeenCalled();
        expect(Sentry.captureException).toHaveBeenCalled();
    });

    it('should keep errors local when observability is disabled', () => {
        (environment as AppEnvironment).observabilityEnabled = false;

        service.error('Local error', new Error('Never send this'));

        expect(console.error).toHaveBeenCalled();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});
