import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppEventUtilities } from './app.event.utilities';
import { LoggerService } from '../services/logger.service';
import { TestBed } from '@angular/core/testing';

describe('AppEventUtilities', () => {
    let mockActivity: any;
    let service: AppEventUtilities;
    let loggerMock: any;

    beforeEach(() => {
        loggerMock = {
            warn: vi.fn(),
            error: vi.fn(),
            log: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                AppEventUtilities,
                { provide: LoggerService, useValue: loggerMock }
            ]
        });

        service = TestBed.inject(AppEventUtilities);

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

                service.enrich(mockActivity, ['Time']);

                expect(mockActivity.generateTimeStream).toHaveBeenCalled();
                expect(mockActivity.addStream).toHaveBeenCalledWith(mockStream);
            });

            it('should NOT call generateTimeStream if Time stream already exists', () => {
                // Setup: Time stream exists
                mockActivity.hasStreamData.mockReturnValue(true);

                service.enrich(mockActivity, ['Time']);

                expect(mockActivity.generateTimeStream).not.toHaveBeenCalled();
                expect(mockActivity.addStream).not.toHaveBeenCalled();
            });

            it('should handle errors gracefully', () => {
                mockActivity.hasStreamData.mockReturnValue(false);
                mockActivity.generateTimeStream.mockImplementation(() => {
                    throw new Error('Some error');
                });

                // Should not throw
                expect(() => service.enrich(mockActivity, ['Time'])).not.toThrow();
                expect(loggerMock.error).toHaveBeenCalled();
            });
        });

        describe('Duration Stream', () => {
            it('should call enrichDurationStream when streamsToEnrich includes "Duration"', () => {
                // Setup: behave as if Duration stream is missing
                mockActivity.hasStreamData.mockImplementation((type: string) => type === 'Time'); // Time present, Duration missing

                // Setup: Mock generateDurationStream
                const mockStream = { type: 'Duration' };
                mockActivity.generateDurationStream.mockReturnValue(mockStream);

                service.enrich(mockActivity, ['Duration']);

                expect(mockActivity.generateDurationStream).toHaveBeenCalled();
                expect(mockActivity.addStream).toHaveBeenCalledWith(mockStream);
            });

            it('should NOT call generateDurationStream if Duration stream already exists', () => {
                // Setup: Duration stream exists
                mockActivity.hasStreamData.mockReturnValue(true);

                service.enrich(mockActivity, ['Duration']);

                expect(mockActivity.generateDurationStream).not.toHaveBeenCalled();
                expect(mockActivity.addStream).not.toHaveBeenCalled();
            });
            it('should handle errors gracefully', () => {
                mockActivity.hasStreamData.mockReturnValue(false);
                mockActivity.generateDurationStream.mockImplementation(() => {
                    throw new Error('Some error');
                });

                // Should not throw
                expect(() => service.enrich(mockActivity, ['Duration'])).not.toThrow();
                expect(loggerMock.error).toHaveBeenCalled();
            });
        });
    });
});
