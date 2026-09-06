import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { DataWeight, DataBodyFat, DataBloodPressureSystolic, DataBloodPressureDiastolic, DataPulseRate, DistanceUnits, PaceUnits, SpeedUnits } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import { APP_STORAGE } from '../../services/storage/app.storage.token';
import {
  ManualHealthMeasurementDialogComponent,
  type ManualHealthMeasurementDialogData,
} from './manual-health-measurement-dialog.component';

describe('ManualHealthMeasurementDialogComponent', () => {
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let storage: Storage;
  let fixture: ComponentFixture<ManualHealthMeasurementDialogComponent>;

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
    fixture = TestBed.createComponent(ManualHealthMeasurementDialogComponent);
    return fixture.componentInstance;
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

  it.each([
    { label: 'default', unitSettings: null },
    { label: 'imperial', unitSettings: {
        ...getDefaultUserUnitSettings(),
        distanceUnits: DistanceUnits.Miles,
        speedUnits: [SpeedUnits.MilesPerHour],
        paceUnits: [PaceUnits.MinutesPerMile],
    } },
  ])('keeps Weight input and submission in Sports Lib kilograms with $label settings', async ({ unitSettings }) => {
    const component = await create({
      metricId: HEALTH_METRIC_IDS.BodyWeight,
      unitSettings,
      existing: { canonicalValue: 80, observedAtMs: Date.UTC(2026, 0, 1, 10), timezoneOffsetSeconds: 0 },
    });
    fixture.detectChanges();
    const weight = new DataWeight(80);
    expect(component.valueUnit()).toBe(weight.getDisplayUnit());
    expect(component.form.controls.canonicalValue.value).toBe(weight.getValue());
    expect(fixture.nativeElement.querySelector('[matTextSuffix]').textContent.trim()).toBe(weight.getDisplayUnit());
    expect(Number(fixture.nativeElement.querySelector('input[type="number"]').value)).toBe(80);
    component.submit();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ canonicalValue: 80 }));
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
      metricId: HEALTH_METRIC_IDS.Vo2Max,
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

  it('offers all entry types and resets readings when switching to paired blood pressure', async () => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BodyWeight, unitSettings: null });
    component.form.patchValue({ canonicalValue: 72 });
    component.selectMetric(HEALTH_METRIC_IDS.BloodPressureSystolic);
    fixture.detectChanges();
    expect(component.metricOptions.map(option => option.label)).toEqual(['Weight', 'VO₂ max', 'Blood pressure', 'Body fat']);
    expect(component.form.controls.canonicalValue.value).toBeNull();
    component.form.patchValue({ canonicalValue: 120 });
    component.submit();
    expect(dialogRef.close).not.toHaveBeenCalled();
    component.form.patchValue({ diastolicValue: 80, pulseValue: 65 });
    component.submit();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
      metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, canonicalValue: 120, diastolicValue: 80, pulseValue: 65,
    }));
    expect(dialogRef.close.mock.calls[0][0]).not.toHaveProperty('vo2Method');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('allows body fat without VO2 metadata or blood-pressure fields and does not persist its value locally', async () => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BodyFat, unitSettings: null });
    component.form.patchValue({ canonicalValue: 20.5 });
    component.submit();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ metricId: HEALTH_METRIC_IDS.BodyFat, canonicalValue: 20.5 }));
    expect(dialogRef.close.mock.calls[0][0]).not.toHaveProperty('diastolicValue');
    expect(dialogRef.close.mock.calls[0][0]).not.toHaveProperty('vo2Context');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('locks measurement type on edit and permits removing an optional pulse', async () => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, unitSettings: null,
      existing: { canonicalValue: 120, diastolicValue: 80, pulseValue: 65,
        observedAtMs: Date.UTC(2026, 0, 1), timezoneOffsetSeconds: 0 } });
    component.selectMetric(HEALTH_METRIC_IDS.BodyFat);
    expect(component.selectedMetric()).toBe(HEALTH_METRIC_IDS.BloodPressureSystolic);
    component.form.patchValue({ pulseValue: null });
    component.submit();
    expect(dialogRef.close.mock.calls[0][0]).not.toHaveProperty('pulseValue');
  });

  it.each([null, { ...getDefaultUserUnitSettings(), distanceUnits: DistanceUnits.Miles }])(
    'uses Sports Lib units for body fat and all paired fields with settings %j', async unitSettings => {
      const component = await create({ metricId: HEALTH_METRIC_IDS.BodyFat, unitSettings });
      fixture.detectChanges();
      expect(component.valueUnit()).toBe(new DataBodyFat(20).getDisplayUnit());
      component.selectMetric(HEALTH_METRIC_IDS.BloodPressureSystolic);
      fixture.detectChanges();
      expect([...fixture.nativeElement.querySelectorAll('[matTextSuffix]')].map((node: HTMLElement) => node.textContent.trim()))
        .toEqual([new DataBloodPressureSystolic(120).getDisplayUnit(), new DataBloodPressureDiastolic(80).getDisplayUnit(), new DataPulseRate(65).getDisplayUnit()]);
      const action = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(action.getAttribute('form')).toBe('manual-health-measurement-form');
    },
  );

  it.each(['1999-12-31', '2026-02-31'])('rejects invalid or pre-2000 calendar input %s', async observedDate => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BodyFat, unitSettings: null });
    component.form.patchValue({ canonicalValue: 20, observedDate, observedTime: '08:00' });
    component.submit();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.submitError()).toContain('valid date');
  });
});
