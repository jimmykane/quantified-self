import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UploadActivitiesToServiceComponent } from './upload-activities-to-service.component';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { UPLOAD_STATUS } from '../upload-status/upload.status';
import { Router } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { LoggerService } from '../../../services/logger.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppProcessingService } from '../../../services/app.processing.service';
import { AppFunctionsService } from '../../../services/app.functions.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppUserService } from '../../../services/app.user.service';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ServiceNames } from '@sports-alliance/sports-lib';

describe('UploadActivitiesToServiceComponent', () => {
    let component: UploadActivitiesToServiceComponent;
    let fixture: ComponentFixture<UploadActivitiesToServiceComponent>;

    const mockSnackBar = { open: vi.fn() };
    const mockDialog = {};
    const mockDialogRef = {};
    const mockProcessingService = {
        addJob: vi.fn(),
        updateJob: vi.fn(),
        completeJob: vi.fn(),
        failJob: vi.fn()
    };
    const mockRouter = {};
    const mockLogger = { error: vi.fn(), info: vi.fn() };
    const mockAnalytics = { logEvent: vi.fn() };
    const mockAuth = { currentUser: { getIdToken: () => Promise.resolve('token') } };
    const mockFunctionsService = { call: vi.fn().mockResolvedValue({ data: { status: 'OK' } }) };
    const mockEventService = {};

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [UploadActivitiesToServiceComponent],
            imports: [HttpClientTestingModule, NoopAnimationsModule],
            providers: [
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: MatDialog, useValue: mockDialog },
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: {} },
                { provide: AppProcessingService, useValue: mockProcessingService },
                { provide: Router, useValue: mockRouter },
                { provide: LoggerService, useValue: mockLogger },
                { provide: AppAnalyticsService, useValue: mockAnalytics },
                { provide: Auth, useValue: mockAuth },
                { provide: AppFunctionsService, useValue: mockFunctionsService },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppUserService, useValue: { hasProAccessSignal: vi.fn().mockReturnValue(true), user: vi.fn().mockReturnValue({ stripeRole: 'pro' }) } },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(UploadActivitiesToServiceComponent);
        component = fixture.componentInstance;
        component.uploadDelayMs = 0;
        mockProcessingService.addJob.mockReset();
        mockProcessingService.updateJob.mockReset();
        mockProcessingService.completeJob.mockReset();
        mockProcessingService.failJob.mockReset();
        mockFunctionsService.call.mockReset();
        mockProcessingService.addJob.mockReturnValue('job-id');
        mockFunctionsService.call.mockResolvedValue({ data: { status: 'OK' } });
        mockSnackBar.open.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should upload base64 file for valid fit file', async () => {
        const file = {
            file: new File(['<fit></fit>'], 'activity.fit', { type: 'application/octet-stream' }),
            filename: 'activity',
            extension: 'fit',
            data: null,
            id: '1',
            name: 'activity.fit',
            status: UPLOAD_STATUS.PROCESSING,
            jobId: '1'
        };

        const promise = component.processAndUploadFile(file);

        // Wait for async file reading
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockFunctionsService.call).toHaveBeenCalledWith(
            'importActivityToSuuntoApp',
            expect.objectContaining({ file: expect.any(String) })
        );

        // Verify base64 string
        const callArgs = mockFunctionsService.call.mock.calls[0];
        const sentData = callArgs[1];
        expect(sentData.file.length).toBeGreaterThan(0);

        await promise;
    });

    it('should call COROS callable when serviceName is COROSAPI', async () => {
        component.serviceName = ServiceNames.COROSAPI;

        const file = {
            file: new File(['<fit></fit>'], 'activity.fit', { type: 'application/octet-stream' }),
            filename: 'activity',
            extension: 'fit',
            data: null,
            id: '1',
            name: 'activity.fit',
            status: UPLOAD_STATUS.PROCESSING,
            jobId: '1'
        };

        const promise = component.processAndUploadFile(file);
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockFunctionsService.call).toHaveBeenCalledWith(
            'importActivityToCOROSAPI',
            expect.objectContaining({ file: expect.any(String) })
        );

        await promise;
    });

    it('should send Wahoo uploads with filename and browser time zone and retain the pending upload id', async () => {
        component.serviceName = ServiceNames.WahooAPI;
        mockFunctionsService.call.mockResolvedValueOnce({
            data: { status: 'pending', uploadId: 'wahoo-upload-1', message: 'Wahoo is processing the activity.' },
        });
        const file = {
            file: new File(['<fit></fit>'], 'activity.fit', { type: 'application/octet-stream' }),
            filename: 'activity',
            extension: 'fit',
            data: null,
            id: '1',
            name: 'activity.fit',
            status: UPLOAD_STATUS.PROCESSING,
            jobId: '1',
        };

        const result = await component.processAndUploadFile(file);

        expect(mockFunctionsService.call).toHaveBeenCalledWith(
            'importActivityToWahooAPI',
            expect.objectContaining({
                file: expect.any(String),
                filename: 'activity.fit',
                timeZone: expect.any(String),
            }),
        );
        expect(result).toEqual({
            success: false,
            duplicate: false,
            pending: true,
            uploadId: 'wahoo-upload-1',
            message: 'Wahoo is processing the activity.',
        });
    });

    it('should reject non-fit files', async () => {
        const file = {
            file: new File(['content'], 'test.txt'),
            filename: 'test',
            extension: 'txt',
            data: null,
            id: '1',
            name: 'test.txt',
            status: UPLOAD_STATUS.PROCESSING,
            jobId: '1'
        };
        await expect(component.processAndUploadFile(file)).rejects.toThrow('Only FIT files are supported.');
    });

    it('should reject fit files larger than 20MB before calling the service function', async () => {
        const oversizedPayload = new ArrayBuffer((20 * 1024 * 1024) + 1);
        const mockFileReader = {
            result: oversizedPayload,
            onload: null as (() => void) | null,
            onerror: null as (() => void) | null,
            readAsArrayBuffer: vi.fn(function (this: { onload: (() => void) | null }) {
                this.onload?.();
            }),
        };
        const fileReaderSpy = vi.spyOn(globalThis as any, 'FileReader').mockImplementation(() => mockFileReader);
        const file = {
            file: new File(['fit'], 'large.fit'),
            filename: 'large',
            extension: 'fit',
            data: null,
            id: '1',
            name: 'large.fit',
            status: UPLOAD_STATUS.PROCESSING,
            jobId: '1'
        };

        await expect(component.processAndUploadFile(file)).rejects.toThrow('Cannot upload activity because the size is greater than 20MB');

        expect(mockFunctionsService.call).not.toHaveBeenCalled();
        fileReaderSpy.mockRestore();
    });

    it('should handle ALREADY_EXISTS response', async () => {
        mockFunctionsService.call.mockResolvedValueOnce({ data: { status: 'info', code: 'ALREADY_EXISTS', message: 'Activity already exists in Suunto' } });
        const file = {
            file: new File(['<fit></fit>'], 'activity.fit', { type: 'application/octet-stream' }),
            filename: 'activity',
            extension: 'fit',
            data: null,
            id: '1',
            name: 'activity.fit',
            status: UPLOAD_STATUS.PROCESSING,
            jobId: '1'
        };

        const result = await component.processAndUploadFile(file);

        expect(mockProcessingService.updateJob).toHaveBeenCalledWith(
            '1',
            expect.objectContaining({ status: 'duplicate' })
        );
        expect(result).toEqual({
            success: true,
            duplicate: true,
            message: 'Activity already exists in Suunto'
        });
    });

    it('getFiles should render one status row per selected FIT file', async () => {
        const fileA = new File(['a'], 'first.fit', { type: 'application/octet-stream' });
        const fileB = new File(['b'], 'second.fit', { type: 'application/octet-stream' });
        const event: any = {
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
            target: {
                files: [fileA, fileB],
                value: 'pending-upload'
            }
        };

        mockProcessingService.addJob
            .mockReturnValueOnce('job-1')
            .mockReturnValueOnce('job-2');

        vi.spyOn(component, 'processAndUploadFile')
            .mockResolvedValueOnce({ success: true, duplicate: false, message: 'Uploaded to Suunto App' } as any)
            .mockResolvedValueOnce({ success: true, duplicate: false, message: 'Uploaded to Suunto App' } as any);

        await component.getFiles(event);

        expect(component.uploadRows()).toHaveLength(2);
        expect(component.uploadRows().map(row => row.name)).toEqual(['first.fit', 'second.fit']);
        expect(component.uploadRows().every(row => row.status === 'success')).toBe(true);
        expect(component.uploadSummary()).toBe('2/2 done');
    });

    it('getFiles should aggregate success, duplicate, and failure results and clear drag payload', async () => {
        const fileA = new File(['a'], 'first.fit', { type: 'application/octet-stream' });
        const fileB = new File(['b'], 'second.fit', { type: 'application/octet-stream' });
        const fileC = new File(['c'], 'third.fit', { type: 'application/octet-stream' });
        const clearItemsSpy = vi.fn();
        const clearDataSpy = vi.fn();
        const stopPropagationSpy = vi.fn();
        const preventDefaultSpy = vi.fn();
        const dropZone = document.createElement('section');
        dropZone.classList.add('drag');
        const event: any = {
            stopPropagation: stopPropagationSpy,
            preventDefault: preventDefaultSpy,
            currentTarget: dropZone,
            target: {
                files: null,
                value: 'pending-upload'
            },
            dataTransfer: {
                files: [fileA, fileB, fileC],
                items: { clear: clearItemsSpy },
                clearData: clearDataSpy
            }
        };

        mockProcessingService.addJob
            .mockReturnValueOnce('job-1')
            .mockReturnValueOnce('job-2')
            .mockReturnValueOnce('job-3');

        vi.spyOn(component, 'processAndUploadFile')
            .mockResolvedValueOnce({ success: true, duplicate: false } as any)
            .mockResolvedValueOnce({ success: true, duplicate: true } as any)
            .mockRejectedValueOnce(new Error('Third upload failed'));

        await component.getFiles(event);

        expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(mockProcessingService.addJob).toHaveBeenCalledTimes(3);
        expect(mockProcessingService.updateJob).toHaveBeenCalledWith('job-1', { status: 'processing', progress: 0 });
        expect(mockProcessingService.updateJob).toHaveBeenCalledWith('job-2', { status: 'processing', progress: 0 });
        expect(mockProcessingService.updateJob).toHaveBeenCalledWith('job-3', { status: 'processing', progress: 0 });
        expect(mockProcessingService.completeJob).toHaveBeenCalledTimes(1);
        expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-1', 'Uploaded to Suunto App');
        expect(mockProcessingService.updateJob).toHaveBeenCalledWith(
            'job-2',
            expect.objectContaining({ status: 'duplicate', progress: 100 })
        );
        expect(mockProcessingService.failJob).toHaveBeenCalledTimes(1);
        expect(mockProcessingService.failJob).toHaveBeenCalledWith('job-3', 'Third upload failed');
        expect(component.uploadRows().map(row => row.status)).toEqual(['success', 'duplicate', 'failed']);
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Processed 3 files: 1 successful, 1 already exist, 1 failed',
            'OK',
            { duration: 5000 }
        );
        expect(clearItemsSpy).toHaveBeenCalledTimes(1);
        expect(clearDataSpy).not.toHaveBeenCalled();
        expect(event.target.value).toBe('');
        expect(dropZone.classList.contains('drag')).toBe(false);
        expect(component.isUploading).toBe(false);
    });

    it('getFiles should fall back to dropped files when the event target has an empty file list', async () => {
        const droppedFile = new File(['a'], 'dropped.fit', { type: 'application/octet-stream' });
        const event: any = {
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
            target: {
                files: [],
                value: 'pending-upload'
            },
            dataTransfer: {
                files: [droppedFile],
                clearData: vi.fn()
            }
        };

        mockProcessingService.addJob.mockReturnValueOnce('job-1');
        vi.spyOn(component, 'processAndUploadFile')
            .mockResolvedValueOnce({ success: true, duplicate: false, message: 'Uploaded to Suunto App' } as any);

        await component.getFiles(event);

        expect(component.uploadRows()).toHaveLength(1);
        expect(component.uploadRows()[0].name).toBe('dropped.fit');
        expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-1', 'Uploaded to Suunto App');
    });

    it('getFiles should pace multi-file provider uploads with a shared inter-file delay', async () => {
        vi.useFakeTimers();
        component.uploadDelayMs = 2000;
        const fileA = new File(['a'], 'first.fit', { type: 'application/octet-stream' });
        const fileB = new File(['b'], 'second.fit', { type: 'application/octet-stream' });
        const event: any = {
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
            target: {
                files: [fileA, fileB],
                value: 'pending-upload'
            }
        };

        mockProcessingService.addJob
            .mockReturnValueOnce('job-1')
            .mockReturnValueOnce('job-2');

        let resolveFirstUpload!: (value: any) => void;
        const firstUpload = new Promise(resolve => {
            resolveFirstUpload = resolve;
        });
        const uploadSpy = vi.spyOn(component, 'processAndUploadFile')
            .mockReturnValueOnce(firstUpload as any)
            .mockResolvedValueOnce({ success: true, duplicate: false, message: 'Uploaded to Suunto App' } as any);

        const uploadPromise = component.getFiles(event);
        await Promise.resolve();

        expect(uploadSpy).toHaveBeenCalledTimes(1);

        resolveFirstUpload({ success: true, duplicate: false, message: 'Uploaded to Suunto App' });
        await Promise.resolve();
        await Promise.resolve();

        expect(uploadSpy).toHaveBeenCalledTimes(1);
        expect(component.uploadRows()[1].message).toBe('Waiting before next upload...');

        await vi.advanceTimersByTimeAsync(1999);
        expect(uploadSpy).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        await uploadPromise;

        expect(uploadSpy).toHaveBeenCalledTimes(2);
        expect(component.uploadRows().map(row => row.status)).toEqual(['success', 'success']);
        expect(event.target.value).toBe('');
    });

    it('getFiles should ignore new drops while an upload batch is active', async () => {
        component.uploadDelayMs = 0;
        const activeFile = new File(['a'], 'active.fit', { type: 'application/octet-stream' });
        const ignoredFile = new File(['b'], 'ignored.fit', { type: 'application/octet-stream' });
        const activeEvent: any = {
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
            target: {
                files: [activeFile],
                value: 'active-upload'
            }
        };
        const ignoredDropZone = document.createElement('section');
        ignoredDropZone.classList.add('drag');
        const ignoredEvent: any = {
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
            currentTarget: ignoredDropZone,
            target: {
                files: [ignoredFile],
                value: 'ignored-upload'
            },
            dataTransfer: {
                files: [ignoredFile],
                clearData: vi.fn()
            }
        };

        let resolveActiveUpload!: (value: any) => void;
        const activeUpload = new Promise(resolve => {
            resolveActiveUpload = resolve;
        });
        const uploadSpy = vi.spyOn(component, 'processAndUploadFile')
            .mockReturnValueOnce(activeUpload as any);

        const activeUploadPromise = component.getFiles(activeEvent);
        await Promise.resolve();

        expect(component.isUploading).toBe(true);
        expect(component.uploadRows()).toHaveLength(1);

        await component.getFiles(ignoredEvent);

        expect(uploadSpy).toHaveBeenCalledTimes(1);
        expect(component.uploadRows()).toHaveLength(1);
        expect(component.uploadRows()[0].name).toBe('active.fit');
        expect(ignoredEvent.target.value).toBe('');
        expect(ignoredEvent.dataTransfer.clearData).toHaveBeenCalledTimes(1);
        expect(ignoredDropZone.classList.contains('drag')).toBe(false);

        resolveActiveUpload({ success: true, duplicate: false, message: 'Uploaded to Suunto App' });
        await activeUploadPromise;
    });

    it('retryUpload should retry one failed row and increment attempts', async () => {
        const fileA = new File(['a'], 'only.fit', { type: 'application/octet-stream' });
        const event: any = {
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
            target: {
                files: [fileA],
                value: 'pending-upload'
            }
        };

        mockProcessingService.addJob
            .mockReturnValueOnce('job-1')
            .mockReturnValueOnce('job-2');

        const uploadSpy = vi.spyOn(component, 'processAndUploadFile')
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValueOnce({ success: true, duplicate: false, message: 'Uploaded to Suunto App' } as any);

        await component.getFiles(event);

        const failedRow = component.uploadRows()[0];
        expect(failedRow.status).toBe('failed');
        expect(failedRow.attempts).toBe(1);
        expect(failedRow.message).toBe('temporary failure');

        await component.retryUpload(failedRow);

        const retriedRow = component.uploadRows()[0];
        expect(uploadSpy).toHaveBeenCalledTimes(2);
        expect(retriedRow.status).toBe('success');
        expect(retriedRow.attempts).toBe(2);
        expect(retriedRow.message).toBe('Uploaded to Suunto App');
        expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-2', 'Uploaded to Suunto App');
    });

    it('retryFailedUploads should retry only failed rows', async () => {
        const fileA = new File(['a'], 'failed.fit', { type: 'application/octet-stream' });
        const fileB = new File(['b'], 'done.fit', { type: 'application/octet-stream' });
        const event: any = {
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
            target: {
                files: [fileA, fileB],
                value: 'pending-upload'
            }
        };

        mockProcessingService.addJob
            .mockReturnValueOnce('job-1')
            .mockReturnValueOnce('job-2')
            .mockReturnValueOnce('job-3');

        const uploadSpy = vi.spyOn(component, 'processAndUploadFile')
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValueOnce({ success: true, duplicate: false, message: 'Uploaded to Suunto App' } as any)
            .mockResolvedValueOnce({ success: true, duplicate: false, message: 'Uploaded to Suunto App' } as any);

        await component.getFiles(event);
        await component.retryFailedUploads();

        expect(uploadSpy).toHaveBeenCalledTimes(3);
        expect(component.uploadRows().map(row => row.status)).toEqual(['success', 'success']);
        expect(component.uploadRows().map(row => row.attempts)).toEqual([2, 1]);
        expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-3', 'Uploaded to Suunto App');
    });

    it('getFiles should mark unsupported rows failed before calling the service function', async () => {
        const fileA = new File(['a'], 'notes.txt', { type: 'text/plain' });
        const event: any = {
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
            target: {
                files: [fileA],
                value: 'pending-upload'
            }
        };

        await component.getFiles(event);

        expect(component.uploadRows()[0].status).toBe('failed');
        expect(component.uploadRows()[0].message).toBe('Only FIT files are supported.');
        expect(mockProcessingService.addJob).not.toHaveBeenCalled();
        expect(mockFunctionsService.call).not.toHaveBeenCalled();
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Upload failed',
            'OK',
            { duration: 5000 }
        );
    });

    it('getFiles should clear DataTransfer via clearData fallback after failure-only single upload', async () => {
        const fileA = new File(['a'], 'only.fit', { type: 'application/octet-stream' });
        const clearDataSpy = vi.fn();
        const event: any = {
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
            target: {
                files: null,
                value: 'pending-upload'
            },
            dataTransfer: {
                files: [fileA],
                clearData: clearDataSpy
            }
        };

        mockProcessingService.addJob.mockReturnValueOnce('job-1');
        vi.spyOn(component, 'processAndUploadFile').mockRejectedValueOnce(new Error('single upload failed'));

        await component.getFiles(event);

        expect(mockProcessingService.failJob).toHaveBeenCalledWith('job-1', 'single upload failed');
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Upload failed',
            'OK',
            { duration: 5000 }
        );
        expect(clearDataSpy).toHaveBeenCalledTimes(1);
        expect(event.target.value).toBe('');
        expect(component.isUploading).toBe(false);
    });
});
