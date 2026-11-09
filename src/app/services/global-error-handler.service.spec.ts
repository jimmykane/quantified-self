import { vi, describe, it, expect, beforeEach } from 'vitest';
import { GlobalErrorHandler } from './global-error-handler.service';

describe('GlobalErrorHandler', () => {
    let handler: GlobalErrorHandler;
    let loggerMock: any;
    let windowMock: any;

    beforeEach(() => {
        const sessionStorageState: Record<string, string> = {};
        loggerMock = {
            error: vi.fn()
        };
        windowMock = {
            windowRef: {
                location: {
                    reload: vi.fn()
                },
                sessionStorage: {
                    getItem: vi.fn((key: string) => sessionStorageState[key] ?? null),
                    setItem: vi.fn((key: string, value: string) => {
                        sessionStorageState[key] = value;
                    })
                }
            }
        };
        handler = new GlobalErrorHandler(loggerMock as any, windowMock as any);
    });

    it('should reload the page when a chunk load error occurs (regex 1)', () => {
        const error = new TypeError('Failed to fetch dynamically imported module: https://example.com/chunk.js');
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).toHaveBeenCalled();
        expect(windowMock.windowRef.sessionStorage.setItem).toHaveBeenCalledWith('app.chunk-load-reload-attempted', '1');
        expect(loggerMock.error).toHaveBeenCalledWith(error);
    });

    it('should reload the page when "Loading chunk" error occurs (regex 2)', () => {
        const error = new Error('Loading chunk 123 failed');
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).toHaveBeenCalled();
        expect(windowMock.windowRef.sessionStorage.setItem).toHaveBeenCalledWith('app.chunk-load-reload-attempted', '1');
        expect(loggerMock.error).toHaveBeenCalledWith(error);
    });

    it('should reload the page when "Loading chunk" error occurs (string conversion)', () => {
        // Test that it works even if error is not an Error object but has a toString matching pattern
        const error = { toString: () => 'Loading chunk 999 failed' };
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).toHaveBeenCalled();
        expect(windowMock.windowRef.sessionStorage.setItem).toHaveBeenCalledWith('app.chunk-load-reload-attempted', '1');
        expect(loggerMock.error).toHaveBeenCalledWith(error);
    });

    it('should NOT reload more than once for repeated chunk load errors in the same session', () => {
        const error = new Error('Loading chunk 123 failed');

        handler.handleError(error);
        handler.handleError(error);

        expect(windowMock.windowRef.location.reload).toHaveBeenCalledTimes(1);
        expect(windowMock.windowRef.sessionStorage.setItem).toHaveBeenCalledTimes(1);
        expect(loggerMock.error).toHaveBeenCalledTimes(2);
    });

    it('should NOT reload for other errors', () => {
        const error = new Error('Some other error');
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).not.toHaveBeenCalled();
        expect(loggerMock.error).toHaveBeenCalledWith(error);
    });

    it.each([
        'Importing a module script failed.',
        'error loading dynamically imported module: https://example.com/chunk.js',
        'Uncaught (in promise): TypeError: Importing a module script failed.',
    ])('uses the shared single reload for browser import failure: %s', message => {
        const error = new TypeError(message);
        windowMock.windowRef.location.reload.mockImplementation(() => {
            expect(windowMock.windowRef.sessionStorage.getItem('app.chunk-load-reload-attempted')).toBe('1');
        });
        handler.handleError(error);
        const nextHandler = new GlobalErrorHandler(loggerMock, windowMock);
        nextHandler.handleError(new TypeError('Failed to fetch dynamically imported module: https://example.com/other.js'));
        expect(windowMock.windowRef.location.reload).toHaveBeenCalledTimes(1);
        expect(windowMock.windowRef.sessionStorage.setItem).toHaveBeenCalledTimes(1);
        expect(loggerMock.error).toHaveBeenCalledWith(error);
        expect(loggerMock.error).toHaveBeenCalledTimes(2);
    });

    it.each(['missing', 'getter', 'read', 'write'])('keeps the original error when session storage is unavailable: %s', failure => {
        const storage = windowMock.windowRef.sessionStorage;
        const unavailable = () => { throw new DOMException('Storage is blocked', 'SecurityError'); };
        if (failure === 'missing') windowMock.windowRef.sessionStorage = undefined;
        if (failure === 'getter') Object.defineProperty(windowMock.windowRef, 'sessionStorage', { get: unavailable });
        if (failure === 'read') storage.getItem.mockImplementation(unavailable);
        if (failure === 'write') storage.setItem.mockImplementation(unavailable);
        const error = new TypeError('Importing a module script failed.');
        expect(() => handler.handleError(error)).not.toThrow();
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).not.toHaveBeenCalled();
        expect(loggerMock.error).toHaveBeenCalledTimes(2);
        expect(loggerMock.error).toHaveBeenCalledWith(error);
    });

    it('retains the reload guard and original report when navigation throws', () => {
        windowMock.windowRef.location.reload.mockImplementation(() => { throw new Error('Navigation cancelled'); });
        const error = new TypeError('Importing a module script failed.');
        expect(() => handler.handleError(error)).not.toThrow();
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).toHaveBeenCalledTimes(1);
        expect(loggerMock.error).toHaveBeenCalledWith(error);
        expect(loggerMock.error).toHaveBeenCalledTimes(2);
    });

    it.each([
        new TypeError('Failed to fetch'),
        new TypeError('Load failed'),
        new Error('NG0750'),
        Object.assign(new Error('Could not load the account settings module.'), {
            code: 'account/settings-load-failed', cause: new TypeError('Importing a module script failed.'),
        }),
    ])('does not reload unrelated errors or explicit account recovery failures: %s', error => {
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).not.toHaveBeenCalled();
        expect(windowMock.windowRef.sessionStorage.setItem).not.toHaveBeenCalled();
        expect(loggerMock.error).toHaveBeenCalledWith(error);
    });

    it('should handle null error objects gracefully', () => {
        handler.handleError(null);
        expect(windowMock.windowRef.location.reload).not.toHaveBeenCalled();
        expect(loggerMock.error).toHaveBeenCalledWith(null);
    });

    it('should handle undefined error objects gracefully', () => {
        handler.handleError(undefined);
        expect(windowMock.windowRef.location.reload).not.toHaveBeenCalled();
        expect(loggerMock.error).toHaveBeenCalledWith(undefined);
    });

    it('should handle error objects without message property', () => {
        const error = {};
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).not.toHaveBeenCalled();
        expect(loggerMock.error).toHaveBeenCalledWith(error);
    });
});
