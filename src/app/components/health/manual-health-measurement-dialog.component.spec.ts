import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { APP_STORAGE } from '../../services/storage/app.storage.token';
import {
  ManualHealthMeasurementDialogComponent,
  type ManualHealthMeasurementDialogData,
} from './manual-health-measurement-dialog.component';

describe('ManualHealthMeasurementDialogComponent', () => {
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let storage: Storage;

  beforeEach(() => {
    dialogRef = { close: vi.fn() };
    storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn().mockReturnValue(null),
      length: 0,
    };
  });

  async function create(data: ManualHealthMeasurementDialogData) {
    await TestBed.configureTestingModule({
      imports: [ManualHealthMeasurementDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: APP_STORAGE, useValue: storage },
      ],
    }).compileComponents();
    return TestBed.createComponent(ManualHealthMeasurementDialogComponent).componentInstance;
  }

  it('submits a canonical Weight measurement with the observed local offset', async () => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BodyWeight, unitSettings: null });
    component.form.patchValue({
      canonicalValue: 72.4,
      observedDate: '2026-06-01',
      observedTime: '08:30',
    });

    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
      canonicalValue: 72.4,
      observedAtMs: expect.any(Number),
      timezoneOffsetSeconds: expect.any(Number),
    }));
    expect(dialogRef.close.mock.calls[0][0]).not.toHaveProperty('vo2Context');
  });

  it('preserves an existing measurement timezone while editing VO2 context and method', async () => {
    const observedAtMs = Date.UTC(2026, 0, 1, 10, 0, 37);
    const component = await create({
      metricId: HEALTH_METRIC_IDS.Vo2Max,
      unitSettings: null,
      existing: {
        canonicalValue: 55,
        observedAtMs,
        timezoneOffsetSeconds: 7_200,
        vo2Context: 'running',
        vo2Method: 'lab_test',
      },
    });
    component.form.patchValue({ canonicalValue: 56.2, vo2Method: 'field_test' });

    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      canonicalValue: 56.2,
      observedAtMs,
      timezoneOffsetSeconds: 7_200,
      vo2Context: 'running',
      vo2Method: 'field_test',
    });
    expect(storage.setItem).toHaveBeenCalledWith('health.manual.vo2-context', 'running');
    expect(storage.setItem).toHaveBeenCalledWith('health.manual.vo2-method', 'field_test');
  });

  it('keeps a future measurement in the dialog with an accessible error', async () => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BodyWeight, unitSettings: null });
    component.form.patchValue({
      canonicalValue: 72,
      observedDate: '2999-01-01',
      observedTime: '12:00',
    });

    component.submit();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.submitError()).toContain('not in the future');
  });
});
