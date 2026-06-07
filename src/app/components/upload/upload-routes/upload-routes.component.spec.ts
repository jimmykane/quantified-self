import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadRoutesComponent } from './upload-routes.component';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppProcessingService } from '../../../services/app.processing.service';
import { AppRouteService } from '../../../services/app.route.service';
import { AppRouteUploadService } from '../../../services/app.route-upload.service';
import { AppUserService } from '../../../services/app.user.service';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';
import { LoggerService } from '../../../services/logger.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { UPLOAD_STATUS } from '../upload-status/upload.status';
import { ROUTE_USAGE_LIMITS } from '@shared/limits';

describe('UploadRoutesComponent', () => {
  let component: UploadRoutesComponent;
  let fixture: ComponentFixture<UploadRoutesComponent>;
  let authServiceMock: any;
  let routeServiceMock: any;
  let routeUploadServiceMock: any;
  let userServiceMock: any;
  let analyticsServiceMock: any;
  let processingServiceMock: any;
  let browserCompatibilityServiceMock: any;
  let loggerMock: any;
  let snackBarMock: any;

  beforeEach(async () => {
    authServiceMock = {
      getUser: vi.fn().mockResolvedValue({ uid: 'u1' }),
      currentUser: { uid: 'u1' },
    };
    routeServiceMock = {
      getRouteCount: vi.fn().mockResolvedValue(3),
    };
    routeUploadServiceMock = {
      uploadRouteFile: vi.fn().mockResolvedValue({
        routeId: 'route-1',
        routesCount: 1,
        routeCount: 1,
        duplicate: false,
        uploadLimit: 10,
        uploadCountAfterWrite: 4,
      }),
    };
    userServiceMock = {
      hasProAccessSignal: vi.fn().mockReturnValue(false),
      getSubscriptionRole: vi.fn().mockResolvedValue('free'),
    };
    analyticsServiceMock = {
      logEvent: vi.fn(),
      logRouteUpload: vi.fn(),
      logRouteUploadBatch: vi.fn(),
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
      warn: vi.fn(),
    };
    snackBarMock = { open: vi.fn() };

    TestBed.configureTestingModule({
      imports: [UploadRoutesComponent],
      providers: [
        { provide: AppAuthService, useValue: authServiceMock },
        { provide: AppRouteService, useValue: routeServiceMock },
        { provide: AppRouteUploadService, useValue: routeUploadServiceMock },
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
    });
    TestBed.overrideComponent(UploadRoutesComponent, {
      set: {
        imports: [CommonModule],
      },
    });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(UploadRoutesComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('initializes user and route upload limits on init', async () => {
    await component.ngOnInit();

    expect(authServiceMock.getUser).toHaveBeenCalled();
    expect(routeServiceMock.getRouteCount).toHaveBeenCalledWith({ uid: 'u1' });
    expect(component.uploadCount).toBe(3);
    expect(component.uploadLimit).toBe(ROUTE_USAGE_LIMITS.free);
  });

  it('falls back to the free route limit for unsupported subscription roles', async () => {
    userServiceMock.getSubscriptionRole.mockResolvedValueOnce('enterprise');

    await component.ngOnInit();

    expect(component.uploadLimit).toBe(ROUTE_USAGE_LIMITS.free);
    expect(loggerMock.error).toHaveBeenCalledWith(
      "[UploadRoutesComponent] Unsupported route upload limit role 'enterprise'",
      expect.any(Error),
    );
  });

  it('rejects unsupported route files', async () => {
    await expect(component.processAndUploadFile(makeUploadFile('route.tcx', 'tcx')))
      .rejects.toThrow('Only FIT and GPX route files are supported.');

    expect(analyticsServiceMock.logRouteUpload).toHaveBeenCalledWith('start', { fileType: 'tcx' });
    expect(analyticsServiceMock.logRouteUpload).toHaveBeenCalledWith('validation_failure', {
      fileType: 'tcx',
      errorCategory: 'unsupported_format',
    });
  });

  it('uploads FIT route files through AppRouteUploadService', async () => {
    component.user = { uid: 'u1' } as any;
    mockFileReaderResult(new Uint8Array([1, 2, 3]).buffer);

    const result = await component.processAndUploadFile(makeUploadFile('course.fit', 'fit'));

    expect(analyticsServiceMock.logRouteUpload).toHaveBeenCalledWith('start', { fileType: 'fit' });
    expect(routeUploadServiceMock.uploadRouteFile).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]).buffer,
      'fit',
      'course.fit',
    );
    expect(analyticsServiceMock.logRouteUpload).toHaveBeenCalledWith('success', {
      fileType: 'fit',
      storedFileType: 'fit',
      compressed: false,
      uploadLimit: 10,
      uploadCountAfterWrite: 4,
    });
    expect(result).toEqual({ routeId: 'route-1', duplicate: false });
  });

  it('gzips GPX route files before upload when compression is available', async () => {
    component.user = { uid: 'u1' } as any;
    mockFileReaderResult(new Uint8Array([1, 2, 3, 4]).buffer);
    const compressedBytes = new Uint8Array([0x1f, 0x8b, 0x08]).buffer;
    vi.spyOn(component as any, 'gzipPayload').mockResolvedValue(compressedBytes);

    await component.processAndUploadFile(makeUploadFile('route.gpx', 'gpx'));

    expect(browserCompatibilityServiceMock.checkCompressionSupport).toHaveBeenCalled();
    expect(routeUploadServiceMock.uploadRouteFile).toHaveBeenCalledWith(
      compressedBytes,
      'gpx.gz',
      'route.gpx',
    );
    expect(analyticsServiceMock.logRouteUpload).toHaveBeenCalledWith('success', expect.objectContaining({
      fileType: 'gpx',
      storedFileType: 'gpx.gz',
      compressed: true,
    }));
  });

  it('reports duplicate single-route upload batches as route duplicates', async () => {
    component.user = { uid: 'u1' } as any;
    routeUploadServiceMock.uploadRouteFile.mockResolvedValueOnce({
      routeId: 'route-1',
      routesCount: 1,
      routeCount: 1,
      duplicate: true,
      uploadLimit: 10,
      uploadCountAfterWrite: 3,
    });
    mockFileReaderResult(new Uint8Array([1, 2, 3]).buffer);
    const uploadCompleteSpy = vi.fn();
    component.routeUploadComplete.subscribe(uploadCompleteSpy);

    await component.getFiles({
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
      target: {
        files: [new File(['abc'], 'route.fit')],
        value: 'route.fit',
      },
    });

    expect(snackBarMock.open).toHaveBeenCalledWith('Route already exists', 'OK', { duration: 5000 });
    expect(analyticsServiceMock.logRouteUpload).toHaveBeenCalledWith('duplicate', expect.objectContaining({
      fileType: 'fit',
      storedFileType: 'fit',
      compressed: false,
      uploadLimit: 10,
      uploadCountAfterWrite: 3,
    }));
    expect(analyticsServiceMock.logRouteUploadBatch).toHaveBeenCalledWith({
      totalFiles: 1,
      successfulUploads: 0,
      duplicateUploads: 1,
      failedUploads: 0,
    });
    expect(uploadCompleteSpy).not.toHaveBeenCalled();
  });
});
