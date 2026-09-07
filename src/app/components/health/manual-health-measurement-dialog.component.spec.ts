import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { DataWeight, DataBodyFat, DataBloodPressureSystolic, DataBloodPressureDiastolic, DataPulseRate,
  DataMuscleMass, DataBodyWater, DataBoneMass, DataBloodOxygenSaturation, DistanceUnits, PaceUnits, SpeedUnits } from '@sports-alliance/sports-lib';
import { MANUAL_HEALTH_METRIC_IDS, MANUAL_HEALTH_VALUE_MAXIMUMS } from '@shared/manual-health';
import { formatCanonicalHealthMetricSportsLibValue } from '@shared/sports-lib-health-data';
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

  it.each(MANUAL_HEALTH_METRIC_IDS)('disables saving invalid %s values in the rendered form', async metricId => {
    const component = await create({ metricId, unitSettings: null });
    fixture.detectChanges();
    if (component.isBloodPressure()) component.form.controls.diastolicValue.setValue(80);
    for (const canonicalValue of [null, 0, -1, NaN, Infinity, -Infinity, MANUAL_HEALTH_VALUE_MAXIMUMS[metricId] + 0.1]) {
      component.form.controls.canonicalValue.setValue(canonicalValue);
      fixture.detectChanges();
      expect(component.form.controls.canonicalValue.invalid).toBe(true);
      expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
      component.submit();
      expect(dialogRef.close).not.toHaveBeenCalled();
    }
    component.form.controls.canonicalValue.setValue(25.5);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
  });

  it('rejects non-finite paired readings but permits an omitted pulse', async () => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, unitSettings: null });
    fixture.detectChanges();
    component.form.patchValue({ canonicalValue: 120, diastolicValue: 80 });
    for (const field of ['diastolicValue', 'pulseValue'] as const) {
      for (const value of [0, -1, NaN, Infinity, 401]) {
        component.form.controls[field].setValue(value);
        component.submit();
        expect(component.form.controls[field].invalid).toBe(true);
        expect(dialogRef.close).not.toHaveBeenCalled();
      }
      component.form.controls[field].setValue(field === 'diastolicValue' ? 80 : null);
    }
    component.submit();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ canonicalValue: 120, diastolicValue: 80 }));
    expect(dialogRef.close.mock.calls[0][0]).not.toHaveProperty('pulseValue');
  });

  it('explains invalid typed weight and clears the error when corrected without rounding decimals', async () => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BodyWeight, unitSettings: null });
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('[formControlName="canonicalValue"]') as HTMLInputElement;
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-error').textContent).toBe(component.valueRangeHint());
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.step).toBe('any');
    input.value = '72.45';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-error')).toBeNull();
    component.submit();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ canonicalValue: 72.45 }));
  });

  it('replaces the active limits when switching measurement types', async () => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BodyWeight, unitSettings: null });
    fixture.detectChanges();
    component.form.controls.canonicalValue.setValue(101);
    expect(component.form.valid).toBe(true);
    component.selectMetric(HEALTH_METRIC_IDS.BodyFat);
    fixture.detectChanges();
    expect(component.form.controls.canonicalValue.value).toBeNull();
    component.form.controls.canonicalValue.setValue(101);
    expect(component.form.controls.canonicalValue.hasError('max')).toBe(true);
    component.form.controls.canonicalValue.setValue(100);
    expect(component.form.valid).toBe(true);
    component.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
    fixture.detectChanges();
    component.form.controls.canonicalValue.setValue(101);
    expect(component.form.valid).toBe(true);
  });

  it.each(['observedDate', 'observedTime'] as const)('explains a missing %s inline', async field => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BodyWeight, unitSettings: null });
    fixture.detectChanges();
    component.form.controls.canonicalValue.setValue(72);
    component.form.controls[field].setValue('');
    component.form.controls[field].markAsTouched();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-error').textContent).toContain('Enter the measurement');
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
  });

  it.each([null, { ...getDefaultUserUnitSettings(), distanceUnits: DistanceUnits.Miles }])(
    'formats every range hint with Sports Lib and unit settings %j', async unitSettings => {
      const component = await create({ metricId: HEALTH_METRIC_IDS.BodyWeight, unitSettings });
      for (const metricId of MANUAL_HEALTH_METRIC_IDS) {
        component.selectMetric(metricId);
        fixture.detectChanges();
        const upper = formatCanonicalHealthMetricSportsLibValue(metricId, MANUAL_HEALTH_VALUE_MAXIMUMS[metricId], unitSettings)!;
        const lower = formatCanonicalHealthMetricSportsLibValue(metricId, 0, unitSettings)!;
        expect(component.valueRangeHint()).toBe(`Enter a number above ${lower.value} and up to ${upper.value} ${upper.unit}.`);
        expect(fixture.nativeElement.querySelector('mat-hint').textContent).toBe(component.valueRangeHint());
      }
    },
  );

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
    expect(component.metricOptions.map(option => option.label)).toEqual([
      'Weight', 'VO₂ max', 'Blood pressure', 'Body fat', 'Muscle mass', 'Body water', 'Bone mass', 'Blood oxygen (SpO₂)',
    ]);
    expect(component.metricOptions.map(option => option.id).sort()).toEqual([...MANUAL_HEALTH_METRIC_IDS].sort());
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

  it.each([
    { metricId: HEALTH_METRIC_IDS.MuscleMass, value: 52.4, dataClass: DataMuscleMass },
    { metricId: HEALTH_METRIC_IDS.BodyWater, value: 57.8, dataClass: DataBodyWater },
    { metricId: HEALTH_METRIC_IDS.BoneMass, value: 3.1, dataClass: DataBoneMass },
    { metricId: HEALTH_METRIC_IDS.BloodOxygenSaturation, value: 98, dataClass: DataBloodOxygenSaturation },
  ].flatMap(measurement => [null, { ...getDefaultUserUnitSettings(), distanceUnits: DistanceUnits.Miles }]
    .map(unitSettings => ({ ...measurement, unitSettings }))))(
    'adds and edits $metricId with Sports Lib units and settings $unitSettings', async ({ metricId, value, dataClass, unitSettings }) => {
      const component = await create({ metricId, unitSettings });
      fixture.detectChanges();
      expect(component.measurementLabel()).toBeTruthy();
      expect(component.contextText()).not.toContain('body fat');
      expect(component.valueUnit()).toBe(new dataClass(value).getDisplayUnit());
      expect(fixture.nativeElement.querySelector('[matTextSuffix]').textContent.trim()).toBe(new dataClass(value).getDisplayUnit());
      component.form.patchValue({ canonicalValue: value });
      component.submit();
      const result = dialogRef.close.mock.calls[0][0];
      expect(result).toMatchObject({ metricId, canonicalValue: value });
      expect(result).not.toHaveProperty('diastolicValue');
      expect(result).not.toHaveProperty('pulseValue');
      expect(result).not.toHaveProperty('vo2Context');
      expect(storage.setItem).not.toHaveBeenCalled();

      fixture.destroy();
      TestBed.resetTestingModule();
      dialogRef.close.mockClear();
      const editing = await create({ metricId, unitSettings, existing: result });
      editing.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
      expect(editing.selectedMetric()).toBe(metricId);
      expect(editing.form.controls.canonicalValue.value).toBe(value);
      editing.form.patchValue({ canonicalValue: value + 0.1 });
      editing.submit();
      expect(dialogRef.close).toHaveBeenCalledWith({ ...result, canonicalValue: value + 0.1 });
    },
  );

  it.each([
    HEALTH_METRIC_IDS.MuscleMass, HEALTH_METRIC_IDS.BodyWater, HEALTH_METRIC_IDS.BoneMass, HEALTH_METRIC_IDS.BloodOxygenSaturation,
  ])('enforces bounds and discards paired fields when switching to %s', async metricId => {
    const component = await create({ metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, unitSettings: null });
    component.form.patchValue({ canonicalValue: 120, diastolicValue: 80, pulseValue: 65 });
    component.selectMetric(metricId);
    expect(component.form.controls.canonicalValue.value).toBeNull();
    expect(component.form.controls.diastolicValue.value).toBeNull();
    expect(component.form.controls.pulseValue.value).toBeNull();
    for (const canonicalValue of [null, 0, -1, NaN, component.maximumValue() + 0.1]) {
      component.form.patchValue({ canonicalValue });
      component.submit();
      expect(dialogRef.close).not.toHaveBeenCalled();
    }
    component.form.patchValue({ canonicalValue: component.maximumValue() });
    component.submit();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ metricId, canonicalValue: component.maximumValue() }));
    expect(dialogRef.close.mock.calls[0][0]).not.toHaveProperty('pulseValue');
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

  it.each([
    { time: '02:30', valid: true },
    { time: '03:30', valid: false },
    { time: '04:30', valid: true },
  ])('does not silently normalize the local DST transition time $time', async ({ time, valid }) => {
    vi.stubEnv('TZ', 'Europe/Helsinki');
    try {
      const component = await create({ metricId: HEALTH_METRIC_IDS.BodyFat, unitSettings: null });
      component.form.patchValue({ canonicalValue: 20, observedDate: '2026-03-29', observedTime: time });

      component.submit();

      if (valid) {
        expect(dialogRef.close).toHaveBeenCalledOnce();
        const result = dialogRef.close.mock.calls[0][0];
        expect(new Date(result.observedAtMs + result.timezoneOffsetSeconds * 1000).toISOString().slice(0, 16))
          .toBe(`2026-03-29T${time}`);
      } else {
        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(component.submitError()).toContain('valid date');
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('preserves an existing fixed-offset time even when it falls in the viewer timezone DST gap', async () => {
    vi.stubEnv('TZ', 'Europe/Helsinki');
    try {
      const existing = {
        canonicalValue: 20, observedAtMs: Date.UTC(2026, 2, 29, 3, 30, 37), timezoneOffsetSeconds: 0,
      };
      const component = await create({ metricId: HEALTH_METRIC_IDS.BodyFat, unitSettings: null, existing });
      component.submit();
      expect(dialogRef.close).toHaveBeenCalledWith({ metricId: HEALTH_METRIC_IDS.BodyFat, ...existing });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
