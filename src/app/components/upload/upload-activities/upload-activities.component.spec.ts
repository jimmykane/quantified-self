import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadActivitiesComponent } from './upload-activities.component';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppFitUploadService } from '../../../services/app.fit-upload.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppProcessingService } from '../../../services/app.processing.service';
import { LoggerService } from '../../../services/logger.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { Overlay } from '@angular/cdk/overlay';
import { Router } from '@angular/router';

describe('UploadActivitiesComponent', () => {
  let component: UploadActivitiesComponent;
  let fixture: ComponentFixture<UploadActivitiesComponent>;

  let authServiceMock: any;
  let eventServiceMock: any;
  let fitUploadServiceMock: any;
  let userServiceMock: any;
  let analyticsServiceMock: any;
  let processingServiceMock: any;
  let loggerMock: any;
  let snackBarMock: any;

  beforeEach(async () => {
    authServiceMock = {
      getUser: vi.fn().mockResolvedValue({ uid: 'u1' }),
    };
    eventServiceMock = {
      getEventCount: vi.fn().mockResolvedValue(5),
    };
    fitUploadServiceMock = {
      uploadFitFile: vi.fn().mockResolvedValue({
        eventId: 'event-1',
        activitiesCount: 1,
        uploadLimit: 10,
        uploadCountAfterWrite: 6,
      }),
    };
    userServiceMock = {
      hasProAccessSignal: vi.fn().mockReturnValue(false),
      getSubscriptionRole: vi.fn().mockResolvedValue('free'),
    };
    analyticsServiceMock = {
      logEvent: vi.fn(),
    };
    processingServiceMock = {
      addJob: vi.fn().mockReturnValue('job-id'),
      updateJob: vi.fn(),
      completeJob: vi.fn(),
      failJob: vi.fn(),
    };
    loggerMock = {
      log: vi.fn(),
      error: vi.fn(),
    };
    snackBarMock = { open: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [UploadActivitiesComponent],
      providers: [
        { provide: AppAuthService, useValue: authServiceMock },
        { provide: AppEventService, useValue: eventServiceMock },
        { provide: AppFitUploadService, useValue: fitUploadServiceMock },
        { provide: AppUserService, useValue: userServiceMock },
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
        { provide: AppProcessingService, useValue: processingServiceMock },
        { provide: LoggerService, useValue: loggerMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: MatBottomSheet, useValue: { open: vi.fn() } },
        { provide: Overlay, useValue: {} },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(UploadActivitiesComponent);
    component = fixture.componentInstance;
  });

  it('should initialize user and upload limits on init', async () => {
    await component.ngOnInit();

    expect(authServiceMock.getUser).toHaveBeenCalled();
    expect(eventServiceMock.getEventCount).toHaveBeenCalledWith({ uid: 'u1' });
    expect(component.uploadCount).toBe(5);
    expect(component.uploadLimit).toBe(10);
  });

  it('should skip upload count checks for pro users', async () => {
    component.user = { uid: 'u1' } as any;
    userServiceMock.hasProAccessSignal.mockReturnValueOnce(true);

    await component.calculateRemainingUploads();

    expect(eventServiceMock.getEventCount).not.toHaveBeenCalled();
    expect(component.uploadCount).toBeNull();
    expect(component.uploadLimit).toBeNull();
  });

  it('should reject non-fit files', async () => {
    await expect(component.processAndUploadFile({
      file: new File(['abc'], 'activity.gpx'),
      extension: 'gpx',
      filename: 'activity',
    })).rejects.toThrow('Only FIT files are supported.');
  });

  it('should upload fit files through AppFitUploadService', async () => {
    component.user = { uid: 'u1' } as any;

    const mockFileReader = {
      result: new Uint8Array([1, 2, 3]).buffer,
      onload: null as any,
      onerror: null as any,
      readAsArrayBuffer: vi.fn().mockImplementation(function () {
        this.onload?.();
      }),
    };
    vi.spyOn(globalThis as any, 'FileReader').mockImplementation(() => mockFileReader);

    const result = await component.processAndUploadFile({
      file: new File(['abc'], 'run.fit'),
      extension: 'fit',
      filename: 'run',
    });

    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('upload_file', { method: 'fit' });
    expect(fitUploadServiceMock.uploadFitFile).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]).buffer,
      'run.fit',
    );
    expect(result.eventId).toBe('event-1');
  });

  it('should show snackbar when upload fails', async () => {
    component.user = { uid: 'u1' } as any;
    fitUploadServiceMock.uploadFitFile.mockRejectedValueOnce(new Error('Upload failed'));

    const mockFileReader = {
      result: new Uint8Array([1]).buffer,
      onload: null as any,
      onerror: null as any,
      readAsArrayBuffer: vi.fn().mockImplementation(function () {
        this.onload?.();
      }),
    };
    vi.spyOn(globalThis as any, 'FileReader').mockImplementation(() => mockFileReader);

    await expect(component.processAndUploadFile({
      file: new File(['abc'], 'run.fit'),
      extension: 'fit',
      filename: 'run',
    })).rejects.toThrow('Upload failed');

    expect(snackBarMock.open).toHaveBeenCalled();
  });
});
