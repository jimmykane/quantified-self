import { AppHapticsService } from '../../services/app.haptics.service';
import { SharedModule } from '../../modules/shared.module';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
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
import {
  ActivityTypes,
  DataActivityTypes,
  DataDistance,
  DataDuration,
  DataSpeed,
  DataSpeedAvg,
  DataSwimPace,
  DataSwimPaceMinutesPer100Yard,
  DistanceUnits,
  EventImporterJSON,
  FileType,
  Privacy,
  SwimPaceUnits
} from '@sports-alliance/sports-lib';

const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };

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
    vi.clearAllMocks();
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
      imports: [ReactiveFormsModule, SharedModule, NoopAnimationsModule],
      providers: [
        { provide: AppHapticsService, useValue: haptics },
        { provide: MatDialogRef, useValue: mockDialogRef },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            user: {
              uid: 'user-1',
              settings: {
                appSettings: { theme: 'dark' },
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

  it('keeps initialization and blocked exports silent', async () => {
    fixture.detectChanges();
    expect(haptics.selection).not.toHaveBeenCalled();
    const tooltips = fixture.debugElement.queryAll(By.directive(MatTooltip));
    expect(tooltips).toHaveLength(0);
    component.exportFromGroup.controls.startDate.setValue(null);
    await component.onSubmit({ preventDefault: vi.fn() });
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(mockFileService.downloadFile).not.toHaveBeenCalled();
    component.exportFromGroup.controls.startDate.setValue(true);
    component.isLoading = true;
    await component.onSubmit({ preventDefault: vi.fn() });
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('gives one feedback per checkbox change, Cancel and accepted submit', async () => {
    fixture.detectChanges();
    fixture.debugElement.query(By.directive(MatSlideToggle)).triggerEventHandler('change', { checked: true });
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.nativeElement.querySelector('button[type=button]').click();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    haptics.selection.mockClear();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(mockFileService.downloadFile).toHaveBeenCalledOnce();
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
      {
        settings: {
          exportToCSVSettings: component.user.settings.exportToCSVSettings,
        },
      },
    );
    expect(mockUserService.updateUserProperties.mock.calls[0][1].settings.appSettings).toBeUndefined();
    expect(mockUserService.updateUserProperties.mock.calls[0][1].settings.unitSettings).toBeUndefined();
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

  it.each([DistanceUnits.Kilometers, DistanceUnits.Miles])(
    'exports unavailable duration as an empty cell while keeping zero and canonical durations (%s)', async distanceUnits => {
      component.user.settings.unitSettings = { ...component.user.settings.unitSettings, distanceUnits };
      component.exportFromGroup.get('name')?.setValue(true);
      component.exportFromGroup.get('duration')?.setValue(true);
      component.events = [undefined, 0, 600, 90000].map((seconds, index) => {
        const event = EventImporterJSON.getEventFromJSON({
          name: `Duration-${index}`, startDate: 0, endDate: 90000000, srcFileType: FileType.FIT,
          description: null, isMerge: false, privacy: Privacy.Private, stats: {}, activities: [],
        });
        if (seconds !== undefined) event.setDuration(new DataDuration(seconds));
        return EventImporterJSON.getEventFromJSON(event.toJSON());
      });

      await component.onSubmit({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

      const blob = mockFileService.downloadFile.mock.calls[0][0] as Blob;
      await expect(readBlobText(blob)).resolves.toBe([
        'Name,Duration',
        '"Duration-0",""',
        `"Duration-1","${new DataDuration(0).getDisplayValue()}"`,
        `"Duration-2","${new DataDuration(600).getDisplayValue()}"`,
        `"Duration-3","${new DataDuration(90000).getDisplayValue(true, false).trim()}"`,
        '',
      ].join('\r\n'));
    });

  it('uses unambiguous local date keys for CSV dates and the filename', async () => {
    component.exportFromGroup.get('startDate')?.setValue(true);

    await component.onSubmit({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    const [blob, filename] = mockFileService.downloadFile.mock.calls[0] as [Blob, string];
    const csv = await readBlobText(blob);
    expect(csv).toContain('"2024-01-01"');
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/);
    expect(filename).not.toMatch(/[\\/]/);
  });

  it('exports swim pace fallback with 100-yard units through sports-lib speed conversion', async () => {
    const speedGetValueSpy = vi.spyOn(DataSpeed.prototype, 'getValue');
    const activityTypes = new DataActivityTypes([ActivityTypes.swimming]);
    const speedAvg = new DataSpeedAvg(1);

    component.user.settings.unitSettings = {
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
    } as any;
    component.exportFromGroup.get('averageSwimPace')?.setValue(true);
    component.events = [{
      startDate: new Date('2024-01-01T08:00:00Z'),
      endDate: new Date('2024-01-01T09:00:00Z'),
      name: 'Swim Event',
      description: '',
      getStat: vi.fn((type: string) => {
        if (type === DataActivityTypes.type) {
          return activityTypes;
        }
        if (type === DataSpeedAvg.type) {
          return speedAvg;
        }
        return null;
      }),
      getDistance: vi.fn(() => new DataDistance(1000)),
      getDuration: vi.fn(),
      getID: vi.fn().mockReturnValue('event-swim-1'),
    } as any];

    await component.onSubmit({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    const blob = mockFileService.downloadFile.mock.calls[0][0] as Blob;
    const csv = await readBlobText(blob);
    expect(csv).toContain('Average Swim Pace');
    expect(csv).toContain(`"01:31 ${DataSwimPaceMinutesPer100Yard.unit}"`);
    expect(speedGetValueSpy).not.toHaveBeenCalledWith(DataSwimPace.type);
    speedGetValueSpy.mockRestore();
  });
});
