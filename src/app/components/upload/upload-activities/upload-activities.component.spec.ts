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
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { UPLOAD_STATUS } from '../upload-status/upload.status';
import { USAGE_LIMITS } from '../../../../../functions/src/shared/limits';

describe('UploadActivitiesComponent', () => {
  let component: UploadActivitiesComponent;
  let fixture: ComponentFixture<UploadActivitiesComponent>;

  let authServiceMock: any;
  let eventServiceMock: any;
  let fitUploadServiceMock: any;
  let userServiceMock: any;
  let analyticsServiceMock: any;
  let processingServiceMock: any;
  let browserCompatibilityServiceMock: any;
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
      uploadActivityFile: vi.fn().mockResolvedValue({
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
    browserCompatibilityServiceMock = {
      checkCompressionSupport: vi.fn().mockReturnValue(true),
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
        { provide: BrowserCompatibilityService, useValue: browserCompatibilityServiceMock },
        { provide: LoggerService, useValue: loggerMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(UploadActivitiesComponent);
    component = fixture.componentInstance;
  });

  function mockFileReaderResult(result: ArrayBuffer): void {
    const mockFileReader = {
      result,
      onload: null as any,
      onerror: null as any,
      readAsArrayBuffer: vi.fn().mockImplementation(function () {
        this.onload?.();
      }),
    };

    vi.spyOn(globalThis as any, 'FileReader').mockImplementation(() => mockFileReader);
  }

  function makeUploadFile(name: string, extension: string) {
    return {
      file: new File(['abc'], name),
      name,
      extension,
      filename: name.replace(/\.[^/.]+$/, ''),
      status: UPLOAD_STATUS.PROCESSING,
    } as any;
  }

  function mockFileReaderError(): void {
    const mockFileReader = {
      result: null as any,
      onload: null as any,
      onerror: null as any,
      readAsArrayBuffer: vi.fn().mockImplementation(function () {
        this.onerror?.();
      }),
    };

    vi.spyOn(globalThis as any, 'FileReader').mockImplementation(() => mockFileReader);
  }

  it('should initialize user and upload limits on init', async () => {
    await component.ngOnInit();

    expect(authServiceMock.getUser).toHaveBeenCalled();
    expect(eventServiceMock.getEventCount).toHaveBeenCalledWith({ uid: 'u1' });
    expect(component.uploadCount).toBe(5);
    expect(component.uploadLimit).toBe(USAGE_LIMITS.free);
  });

  it('should skip upload count checks for pro users', async () => {
    component.user = { uid: 'u1' } as any;
    userServiceMock.hasProAccessSignal.mockReturnValueOnce(true);

    await component.calculateRemainingUploads();

    expect(eventServiceMock.getEventCount).not.toHaveBeenCalled();
    expect(component.uploadCount).toBeNull();
    expect(component.uploadLimit).toBeNull();
  });

  it('should reject unsupported files', async () => {
    await expect(component.processAndUploadFile(makeUploadFile('activity.csv', 'csv')))
      .rejects.toThrow('Only FIT, GPX, TCX, JSON, and SML files are supported.');
  });

  it('should upload fit files through AppFitUploadService', async () => {
    component.user = { uid: 'u1' } as any;
    mockFileReaderResult(new Uint8Array([1, 2, 3]).buffer);

    const result = await component.processAndUploadFile(makeUploadFile('run.fit', 'fit'));

    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('upload_file', { method: 'fit' });
    expect(fitUploadServiceMock.uploadActivityFile).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]).buffer,
      'fit',
      'run.fit',
    );
    expect(result.eventId).toBe('event-1');
  });

  it('should gzip text files and upload with .gz extension', async () => {
    component.user = { uid: 'u1' } as any;
    mockFileReaderResult(new Uint8Array([1, 2, 3, 4]).buffer);

    const compressedBytes = new Uint8Array([0x1f, 0x8b, 0x08]).buffer;
    vi.spyOn(component as any, 'gzipPayload').mockResolvedValue(compressedBytes);

    await component.processAndUploadFile(makeUploadFile('run.gpx', 'gpx'));

    expect(browserCompatibilityServiceMock.checkCompressionSupport).toHaveBeenCalled();
    expect(fitUploadServiceMock.uploadActivityFile).toHaveBeenCalledWith(
      compressedBytes,
      'gpx.gz',
      'run.gpx',
    );
  });

  it('should keep already gzipped text payloads without recompressing', async () => {
    component.user = { uid: 'u1' } as any;
    mockFileReaderResult(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]).buffer);
    const gzipSpy = vi.spyOn(component as any, 'gzipPayload');

    await component.processAndUploadFile(makeUploadFile('run.gpx', 'gpx'));

    expect(gzipSpy).not.toHaveBeenCalled();
    expect(fitUploadServiceMock.uploadActivityFile).toHaveBeenCalledWith(
      new Uint8Array([0x1f, 0x8b, 0x08, 0x00]).buffer,
      'gpx.gz',
      'run.gpx',
    );
  });

  it('should upload text payload without gzip when compression is unsupported', async () => {
    component.user = { uid: 'u1' } as any;
    browserCompatibilityServiceMock.checkCompressionSupport.mockReturnValue(false);
    mockFileReaderResult(new Uint8Array([1, 2, 3, 4]).buffer);
    const gzipSpy = vi.spyOn(component as any, 'gzipPayload');

    await component.processAndUploadFile(makeUploadFile('run.gpx', 'gpx'));

    expect(gzipSpy).not.toHaveBeenCalled();
    expect(fitUploadServiceMock.uploadActivityFile).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3, 4]).buffer,
      'gpx',
      'run.gpx',
    );
  });

  it('should show snackbar when upload fails', async () => {
    component.user = { uid: 'u1' } as any;
    fitUploadServiceMock.uploadActivityFile.mockRejectedValueOnce(new Error('Upload failed'));
    mockFileReaderResult(new Uint8Array([1]).buffer);

    await expect(component.processAndUploadFile(makeUploadFile('run.fit', 'fit')))
      .rejects.toThrow('Upload failed');

    expect(snackBarMock.open).toHaveBeenCalled();
  });

  it('should show snackbar when file reader fails before upload starts', async () => {
    component.user = { uid: 'u1' } as any;
    mockFileReaderError();

    await expect(component.processAndUploadFile(makeUploadFile('run.fit', 'fit')))
      .rejects
      .toThrow('Could not read file.');

    expect(fitUploadServiceMock.uploadActivityFile).not.toHaveBeenCalled();
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Could not upload run.fit, reason: Could not read file.',
      'OK',
      { duration: 4000 },
    );
  });

  it('should translate generic server upload errors into friendly snackbar message', async () => {
    component.user = { uid: 'u1' } as any;
    fitUploadServiceMock.uploadActivityFile.mockRejectedValueOnce(new Error('Upload failed (500).'));
    mockFileReaderResult(new Uint8Array([1]).buffer);

    await expect(component.processAndUploadFile(makeUploadFile('run.fit', 'fit')))
      .rejects.toThrow('Upload failed (500).');

    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Could not upload run.fit, reason: Upload failed because the server is temporarily unavailable. Please try again shortly.',
      'OK',
      { duration: 4000 },
    );
  });

  it('should translate upload status 429 into tier limit snackbar message', async () => {
    component.user = { uid: 'u1' } as any;
    fitUploadServiceMock.uploadActivityFile.mockRejectedValueOnce(new Error('Upload failed (429).'));
    mockFileReaderResult(new Uint8Array([1]).buffer);

    await expect(component.processAndUploadFile(makeUploadFile('run.fit', 'fit')))
      .rejects.toThrow('Upload failed (429).');

    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Could not upload run.fit, reason: Upload limit reached for your current plan.',
      'OK',
      { duration: 4000 },
    );
  });

  it('should translate upload status 401 into re-auth snackbar message', async () => {
    component.user = { uid: 'u1' } as any;
    fitUploadServiceMock.uploadActivityFile.mockRejectedValueOnce(new Error('Upload failed (401).'));
    mockFileReaderResult(new Uint8Array([1]).buffer);

    await expect(component.processAndUploadFile(makeUploadFile('run.fit', 'fit')))
      .rejects.toThrow('Upload failed (401).');

    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Could not upload run.fit, reason: Upload is not authorized. Please sign in again.',
      'OK',
      { duration: 4000 },
    );
  });

  it('should translate upload status 400 into invalid file snackbar message', async () => {
    component.user = { uid: 'u1' } as any;
    fitUploadServiceMock.uploadActivityFile.mockRejectedValueOnce(new Error('Upload failed (400).'));
    mockFileReaderResult(new Uint8Array([1]).buffer);

    await expect(component.processAndUploadFile(makeUploadFile('run.fit', 'fit')))
      .rejects.toThrow('Upload failed (400).');

    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Could not upload run.fit, reason: Could not process uploaded file. Check file format and try again.',
      'OK',
      { duration: 4000 },
    );
  });
});
