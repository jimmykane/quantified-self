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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

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
    const mockUserService = {};

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
        mockProcessingService.addJob.mockReset();
        mockProcessingService.updateJob.mockReset();
        mockProcessingService.completeJob.mockReset();
        mockProcessingService.failJob.mockReset();
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
        try {
            await component.processAndUploadFile(file);
            expect.unreachable('Should have rejected');
        } catch (e) {
            expect(e).toBe('Unknown file type');
        }
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
        // Snackbar is now shown by parent abstract directive, we just verify the result
        expect(result).toEqual({ success: true, duplicate: true });
    });

    it('getFiles should aggregate success, duplicate, and failure results and clear drag payload', async () => {
        const fileA = new File(['a'], 'first.fit', { type: 'application/octet-stream' });
        const fileB = new File(['b'], 'second.fit', { type: 'application/octet-stream' });
        const fileC = new File(['c'], 'third.fit', { type: 'application/octet-stream' });
        const clearItemsSpy = vi.fn();
        const clearDataSpy = vi.fn();
        const stopPropagationSpy = vi.fn();
        const preventDefaultSpy = vi.fn();
        const event: any = {
            stopPropagation: stopPropagationSpy,
            preventDefault: preventDefaultSpy,
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

        expect(stopPropagationSpy).toHaveBeenCalledTimes(2);
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(mockProcessingService.addJob).toHaveBeenCalledTimes(3);
        expect(mockProcessingService.updateJob).toHaveBeenCalledWith('job-1', { status: 'processing', progress: 0 });
        expect(mockProcessingService.updateJob).toHaveBeenCalledWith('job-2', { status: 'processing', progress: 0 });
        expect(mockProcessingService.updateJob).toHaveBeenCalledWith('job-3', { status: 'processing', progress: 0 });
        expect(mockProcessingService.completeJob).toHaveBeenCalledTimes(2);
        expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-1');
        expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-2');
        expect(mockProcessingService.failJob).toHaveBeenCalledTimes(1);
        expect(mockProcessingService.failJob).toHaveBeenCalledWith('job-3', 'Third upload failed');
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Processed 3 files: 1 successful, 1 already exist, 1 failed',
            'OK',
            { duration: 5000 }
        );
        expect(clearItemsSpy).toHaveBeenCalledTimes(1);
        expect(clearDataSpy).not.toHaveBeenCalled();
        expect(event.target.value).toBe('');
        expect(component.isUploading).toBe(false);
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
