import { vi, describe, it, expect, beforeEach } from 'vitest';
import { LoggerService } from './logger.service';
import * as Sentry from '@sentry/browser';

// Mock Sentry
vi.mock('@sentry/browser', () => ({
    captureException: vi.fn(),
}));

describe('LoggerService', () => {
    let service: LoggerService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new LoggerService();
        // Mock console methods
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    it('should log regular errors to console and Sentry', () => {
        const testError = new Error('Regular error');
        service.error('Error occurred', testError);

        expect(console.error).toHaveBeenCalled();
        expect(Sentry.captureException).toHaveBeenCalledWith(testError);
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

    it('should NOT mute errors that just happen to contain similar words', () => {
        service.error('Firestore is up', new Error('Not shutting down'));

        expect(console.error).toHaveBeenCalled();
        expect(Sentry.captureException).toHaveBeenCalled();
    });
});
