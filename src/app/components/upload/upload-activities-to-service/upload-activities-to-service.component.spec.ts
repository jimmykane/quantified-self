import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UploadActivitiesToServiceComponent } from './upload-activities-to-service.component';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { UPLOAD_STATUS } from '../upload-status/upload.status';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
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
    const mockProcessingService = { updateJob: vi.fn() };
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
                { provide: AppUserService, useValue: mockUserService },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(UploadActivitiesToServiceComponent);
        component = fixture.componentInstance;
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
        mockFunctionsService.call.mockResolvedValueOnce({ data: { result: { status: 'info', code: 'ALREADY_EXISTS', message: 'Activity already exists in Suunto' } } });
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

        await component.processAndUploadFile(file);

        expect(mockProcessingService.updateJob).toHaveBeenCalledWith(
            '1',
            expect.objectContaining({ status: 'duplicate' })
        );
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            expect.stringContaining('Activity already exists'),
            'OK',
            expect.any(Object)
        );
    });

    it('should handle ALREADY_EXISTS in nested result structure', async () => {
        // This mimics the actual Suunto API response structure: { result: { status: 'info', code: 'ALREADY_EXISTS', message: '...' } }
        mockFunctionsService.call.mockResolvedValueOnce({ data: { result: { status: 'info', code: 'ALREADY_EXISTS', message: 'Activity already exists in Suunto' } } });
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

        await component.processAndUploadFile(file);

        expect(mockProcessingService.updateJob).toHaveBeenCalledWith(
            '1',
            expect.objectContaining({ status: 'duplicate' })
        );
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            expect.stringContaining('Activity already exists'),
            'OK',
            expect.any(Object)
        );
    });
});
