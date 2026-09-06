import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  HEALTH_METRIC_IDS,
  type HealthMetricId,
} from '@shared/health';
import {
  MANUAL_VO2_CONTEXTS,
  MANUAL_VO2_METHODS,
  type ManualHealthMetricId,
  type ManualVo2Context,
  type ManualVo2Method,
} from '@shared/manual-health';
import { formatCanonicalHealthMetricSportsLibValue } from '@shared/sports-lib-health-data';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { APP_STORAGE } from '../../services/storage/app.storage.token';

const VO2_CONTEXT_STORAGE_KEY = 'health.manual.vo2-context';
const VO2_METHOD_STORAGE_KEY = 'health.manual.vo2-method';

export interface ManualHealthMeasurementDialogValue {
  canonicalValue: number;
  observedAtMs: number;
  timezoneOffsetSeconds: number;
  vo2Context?: ManualVo2Context;
  vo2Method?: ManualVo2Method;
}

export interface ManualHealthMeasurementDialogData {
  metricId: ManualHealthMetricId;
  unitSettings: UserUnitSettingsInterface | null;
  existing?: ManualHealthMeasurementDialogValue;
}

export type ManualHealthMeasurementDialogResult = ManualHealthMeasurementDialogValue;

@Component({
  selector: 'app-manual-health-measurement-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './manual-health-measurement-dialog.component.html',
  styleUrls: ['./manual-health-measurement-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManualHealthMeasurementDialogComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<
    ManualHealthMeasurementDialogComponent,
    ManualHealthMeasurementDialogResult | undefined
  >);
  private readonly storage = inject(APP_STORAGE);
  readonly data = inject<ManualHealthMeasurementDialogData>(MAT_DIALOG_DATA);
  readonly submitError = signal<string | null>(null);
  readonly isWeight = this.data.metricId === HEALTH_METRIC_IDS.BodyWeight;
  readonly title = `${this.data.existing ? 'Edit' : 'Add'} ${this.isWeight ? 'weight' : 'VO₂ max'}`;
  readonly valueLabel = this.isWeight ? 'Weight' : 'VO₂ max';
  readonly valueUnit = formatCanonicalHealthMetricSportsLibValue(
    this.data.metricId,
    this.data.existing?.canonicalValue ?? 1,
    this.data.unitSettings,
  )?.unit || '';
  readonly maximumValue = this.isWeight ? 1_000 : 150;
  readonly valueStep = this.isWeight ? 0.1 : 0.1;
  readonly vo2Contexts = MANUAL_VO2_CONTEXTS;
  readonly vo2Methods = MANUAL_VO2_METHODS;
  readonly todayDate = latestEditableCalendarDate(this.data.existing);
  private readonly initialObservedDate = measurementDateValue(this.data.existing);
  private readonly initialObservedTime = measurementTimeValue(this.data.existing);
  readonly form = this.formBuilder.nonNullable.group({
    canonicalValue: [
      this.data.existing?.canonicalValue ?? null as number | null,
      [Validators.required, Validators.min(Number.EPSILON), Validators.max(this.maximumValue)],
    ],
    observedDate: [
      this.initialObservedDate,
      [Validators.required, Validators.pattern(/^\d{4}-\d{2}-\d{2}$/)],
    ],
    observedTime: [
      this.initialObservedTime,
      [Validators.required, Validators.pattern(/^\d{2}:\d{2}$/)],
    ],
    vo2Context: [this.initialVo2Context()],
    vo2Method: [this.initialVo2Method()],
  });
  readonly actionLabel = computed(() => this.data.existing ? 'Save changes' : 'Add measurement');

  close(): void {
    this.dialogRef.close();
  }

  submit(): void {
    this.submitError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const observedDate = new Date(`${value.observedDate}T${value.observedTime}:00`);
    const timezoneOffsetSeconds = this.data.existing?.timezoneOffsetSeconds
      ?? -observedDate.getTimezoneOffset() * 60;
    const observedAtMs = this.data.existing
      && value.observedDate === this.initialObservedDate
      && value.observedTime === this.initialObservedTime
      ? this.data.existing.observedAtMs
      : this.data.existing
        ? Date.parse(`${value.observedDate}T${value.observedTime}:00.000Z`) - (timezoneOffsetSeconds * 1000)
      : observedDate.getTime();
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs > Date.now() + (5 * 60 * 1000)) {
      this.submitError.set('Choose a valid date and time that is not in the future.');
      return;
    }
    const canonicalValue = Number(value.canonicalValue);
    if (!Number.isFinite(canonicalValue) || canonicalValue <= 0 || canonicalValue > this.maximumValue) {
      this.submitError.set(`Enter a ${this.valueLabel.toLowerCase()} within the supported range.`);
      return;
    }
    const result: ManualHealthMeasurementDialogResult = {
      canonicalValue,
      observedAtMs,
      timezoneOffsetSeconds,
    };
    if (!this.isWeight) {
      const vo2Context = value.vo2Context as ManualVo2Context;
      const vo2Method = value.vo2Method as ManualVo2Method;
      result.vo2Context = vo2Context;
      result.vo2Method = vo2Method;
      this.rememberVo2Choice(VO2_CONTEXT_STORAGE_KEY, vo2Context);
      this.rememberVo2Choice(VO2_METHOD_STORAGE_KEY, vo2Method);
    }
    this.dialogRef.close(result);
  }

  contextLabel(context: ManualVo2Context): string {
    switch (context) {
      case 'general': return 'General';
      case 'running': return 'Running';
      case 'cycling': return 'Cycling';
    }
  }

  methodLabel(method: ManualVo2Method): string {
    switch (method) {
      case 'lab_test': return 'Lab test';
      case 'field_test': return 'Field test';
      case 'other_estimate': return 'Other estimate';
    }
  }

  private initialVo2Context(): ManualVo2Context {
    if (this.data.existing?.vo2Context) return this.data.existing.vo2Context;
    return readRememberedChoice(this.storage, VO2_CONTEXT_STORAGE_KEY, MANUAL_VO2_CONTEXTS) || 'general';
  }

  private initialVo2Method(): ManualVo2Method {
    if (this.data.existing?.vo2Method) return this.data.existing.vo2Method;
    return readRememberedChoice(this.storage, VO2_METHOD_STORAGE_KEY, MANUAL_VO2_METHODS) || 'lab_test';
  }

  private rememberVo2Choice(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch {
      // Storage preferences are optional; the measurement remains valid without them.
    }
  }
}

function readRememberedChoice<T extends string>(
  storage: Storage,
  key: string,
  allowed: readonly T[],
): T | null {
  try {
    const value = storage.getItem(key);
    return allowed.includes(value as T) ? value as T : null;
  } catch {
    return null;
  }
}

function measurementDateValue(value: ManualHealthMeasurementDialogValue | undefined): string {
  if (!value) return localDateInputValue(new Date());
  return offsetDate(value).toISOString().slice(0, 10);
}

function measurementTimeValue(value: ManualHealthMeasurementDialogValue | undefined): string {
  if (!value) return localTimeInputValue(new Date());
  return offsetDate(value).toISOString().slice(11, 16);
}

function offsetDate(value: ManualHealthMeasurementDialogValue): Date {
  return new Date(value.observedAtMs + value.timezoneOffsetSeconds * 1000);
}

function localDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function latestEditableCalendarDate(
  value: ManualHealthMeasurementDialogValue | undefined,
): string {
  if (!value) return localDateInputValue(new Date());
  return new Date(Date.now() + value.timezoneOffsetSeconds * 1000).toISOString().slice(0, 10);
}

function localTimeInputValue(value: Date): string {
  return `${value.getHours()}`.padStart(2, '0') + ':' + `${value.getMinutes()}`.padStart(2, '0');
}

export function isManualEntryMetric(metricId: HealthMetricId | 'sleep'): metricId is ManualHealthMetricId {
  return metricId === HEALTH_METRIC_IDS.BodyWeight || metricId === HEALTH_METRIC_IDS.Vo2Max;
}
