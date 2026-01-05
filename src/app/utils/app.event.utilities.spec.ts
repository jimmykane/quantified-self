import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppEventUtilities } from './app.event.utilities';
import { ActivityInterface } from '@sports-alliance/sports-lib';

describe('AppEventUtilities', () => {
    let mockActivity: any;

    beforeEach(() => {
        // Create a mock object with necessary methods
        mockActivity = {
            hasStreamData: vi.fn(),
            getID: vi.fn().mockReturnValue('act-1'),
            addStream: vi.fn(),
            generateTimeStream: vi.fn(),
            generateDurationStream: vi.fn()
        };
    });

    describe('enrich', () => {
        describe('Time Stream', () => {
            it('should call enrichTimeStream when streamsToEnrich includes "Time"', () => {
                // Setup: behave as if Time stream is missing
                mockActivity.hasStreamData.mockReturnValue(false);

                // Setup: Mock generateTimeStream to return a dummy stream
                const mockStream = { type: 'Time' };
                mockActivity.generateTimeStream.mockReturnValue(mockStream);

                AppEventUtilities.enrich(mockActivity, ['Time']);

                expect(mockActivity.generateTimeStream).toHaveBeenCalled();
                expect(mockActivity.addStream).toHaveBeenCalledWith(mockStream);
            });

            it('should NOT call generateTimeStream if Time stream already exists', () => {
                // Setup: Time stream exists
                mockActivity.hasStreamData.mockReturnValue(true);

                AppEventUtilities.enrich(mockActivity, ['Time']);

                expect(mockActivity.generateTimeStream).not.toHaveBeenCalled();
                expect(mockActivity.addStream).not.toHaveBeenCalled();
            });

            it('should handle errors gracefully', () => {
                mockActivity.hasStreamData.mockReturnValue(false);
                mockActivity.generateTimeStream.mockImplementation(() => {
                    throw new Error('Some error');
                });

                // Should not throw
                expect(() => AppEventUtilities.enrich(mockActivity, ['Time'])).not.toThrow();
            });
        });

        describe('Duration Stream', () => {
            it('should call enrichDurationStream when streamsToEnrich includes "Duration"', () => {
                // Setup: behave as if Duration stream is missing
                mockActivity.hasStreamData.mockImplementation((type: string) => type === 'Time'); // Time present, Duration missing

                // Setup: Mock generateDurationStream
                const mockStream = { type: 'Duration' };
                mockActivity.generateDurationStream.mockReturnValue(mockStream);

                AppEventUtilities.enrich(mockActivity, ['Duration']);

                expect(mockActivity.generateDurationStream).toHaveBeenCalled();
                expect(mockActivity.addStream).toHaveBeenCalledWith(mockStream);
            });

            it('should NOT call generateDurationStream if Duration stream already exists', () => {
                // Setup: Duration stream exists
                mockActivity.hasStreamData.mockReturnValue(true);

                AppEventUtilities.enrich(mockActivity, ['Duration']);

                expect(mockActivity.generateDurationStream).not.toHaveBeenCalled();
                expect(mockActivity.addStream).not.toHaveBeenCalled();
            });
            it('should handle errors gracefully', () => {
                mockActivity.hasStreamData.mockReturnValue(false);
                mockActivity.generateDurationStream.mockImplementation(() => {
                    throw new Error('Some error');
                });

                // Should not throw
                expect(() => AppEventUtilities.enrich(mockActivity, ['Duration'])).not.toThrow();
            });
        });
    });
});
