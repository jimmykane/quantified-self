import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventsExportFormComponent } from './events-export.form.component';
import { AppUserService } from '../../services/app.user.service';
import { AppFileService } from '../../services/app.file.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { LoggerService } from '../../services/logger.service';
import { DataDistance, DistanceUnits } from '@sports-alliance/sports-lib';

describe('EventsExportFormComponent', () => {
  let fixture: ComponentFixture<EventsExportFormComponent>;
  let component: EventsExportFormComponent;
  let mockUserService: { updateUserProperties: ReturnType<typeof vi.fn> };
  let mockFileService: { downloadFile: ReturnType<typeof vi.fn> };
  let mockAnalyticsService: { logEvent: ReturnType<typeof vi.fn> };
  let mockLogger: { error: ReturnType<typeof vi.fn> };
  let mockDialogRef: { close: ReturnType<typeof vi.fn> };

  const readBlobText = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(`${reader.result ?? ''}`);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

  beforeEach(async () => {
    mockUserService = {
      updateUserProperties: vi.fn().mockResolvedValue(undefined),
    };
    mockFileService = {
      downloadFile: vi.fn(),
    };
    mockAnalyticsService = {
      logEvent: vi.fn(),
    };
    mockLogger = {
      error: vi.fn(),
    };
    mockDialogRef = {
      close: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [EventsExportFormComponent],
      imports: [ReactiveFormsModule],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            user: {
              uid: 'user-1',
              settings: {
                unitSettings: {},
                exportToCSVSettings: {
                  startDate: false,
                  name: false,
                  description: false,
                  activityTypes: false,
                  distance: false,
                  duration: false,
                  ascent: false,
                  descent: false,
                  calories: false,
                  feeling: false,
                  rpe: false,
                  averageSpeed: false,
                  averagePace: false,
                  averageSwimPace: false,
                  avgGradeAdjustedPace: false,
                  averageGradeAdjustedPace: false,
                  averageHeartRate: false,
                  maximumHeartRate: false,
                  averagePower: false,
                  maximumPower: false,
                  vO2Max: false,
                },
              },
            },
            events: [{
              startDate: new Date('2024-01-01T08:00:00Z'),
              endDate: new Date('2024-01-01T09:00:00Z'),
              name: 'Example Event',
              description: '',
              getStat: vi.fn().mockReturnValue(null),
              getDistance: vi.fn(() => new DataDistance(10000)),
              getID: vi.fn().mockReturnValue('event-1'),
            }],
          },
        },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: AppUserService, useValue: mockUserService },
        { provide: AppFileService, useValue: mockFileService },
        { provide: AppAnalyticsService, useValue: mockAnalyticsService },
        { provide: LoggerService, useValue: mockLogger },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsExportFormComponent);
    component = fixture.componentInstance;
  });

  it('logs and swallows export settings persistence failures after download', async () => {
    mockUserService.updateUserProperties.mockRejectedValueOnce(new Error('write failed'));

    await component.onSubmit({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockDialogRef.close).toHaveBeenCalled();
    expect(mockFileService.downloadFile).toHaveBeenCalled();
    expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1' }),
      expect.objectContaining({
        settings: expect.any(Object),
      }),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[EventsExportFormComponent] Failed to persist export settings',
      expect.any(Error),
    );
    expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('download_csv', {});
  });

  it('exports distance using the user distance preference', async () => {
    component.user.settings.unitSettings = {
      distanceUnits: DistanceUnits.Miles,
    } as any;
    component.exportFromGroup.get('distance')?.setValue(true);

    await component.onSubmit({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    const blob = mockFileService.downloadFile.mock.calls[0][0] as Blob;
    await expect(readBlobText(blob)).resolves.toContain('"6.22 mi"');
  });
});
