import { vi, describe, it, expect, beforeEach } from 'vitest';
import { GlobalErrorHandler } from './global-error-handler.service';

describe('GlobalErrorHandler', () => {
    let handler: GlobalErrorHandler;
    let loggerMock: any;
    let windowMock: any;

    beforeEach(() => {
        loggerMock = {
            error: vi.fn()
        };
        windowMock = {
            windowRef: {
                location: {
                    reload: vi.fn()
                }
            }
        };
        handler = new GlobalErrorHandler(loggerMock as any, windowMock as any);
    });

    it('should reload the page when a chunk load error occurs (regex 1)', () => {
        const error = new TypeError('Failed to fetch dynamically imported module: https://example.com/chunk.js');
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).toHaveBeenCalled();
        expect(loggerMock.error).toHaveBeenCalledWith(error);
    });

    it('should reload the page when "Loading chunk" error occurs (regex 2)', () => {
        const error = new Error('Loading chunk 123 failed');
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).toHaveBeenCalled();
        expect(loggerMock.error).toHaveBeenCalledWith(error);
    });

    it('should reload the page when "Loading chunk" error occurs (string conversion)', () => {
        // Test that it works even if error is not an Error object but has a toString matching pattern
        const error = { toString: () => 'Loading chunk 999 failed' };
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).toHaveBeenCalled();
        expect(loggerMock.error).toHaveBeenCalledWith(error);
    });

    it('should NOT reload for other errors', () => {
        const error = new Error('Some other error');
        handler.handleError(error);
        expect(windowMock.windowRef.location.reload).not.toHaveBeenCalled();
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
