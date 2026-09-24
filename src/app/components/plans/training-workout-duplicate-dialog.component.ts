import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import dayjs, { type Dayjs } from 'dayjs';
import { normalizeTrainingLocalDate } from '@shared/training-plans';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';
import { DayjsDateAdapter } from '../../shared/adapters/dayjs-date-adapter';
import { MAT_DAYJS_DATE_FORMATS } from '../../shared/adapters/mat-dayjs-date.module';

export interface TrainingWorkoutDuplicateDialogData {
  title: string;
  scopeName: string;
  localDate: string;
  startOfWeek: number | null;
  planRange: { startLocalDate: string; endLocalDate: string } | null;
}

class TrainingDuplicateDateAdapter extends DayjsDateAdapter {
  constructor(locale: string, private readonly startOfWeek: number | null) { super(locale); }

  override getFirstDayOfWeek(): number {
    return Number.isInteger(this.startOfWeek) && this.startOfWeek! >= 0 && this.startOfWeek! <= 6
      ? this.startOfWeek! : 1;
  }
}

export function duplicateWorkoutLocalDate(value: Dayjs | null): string | null {
  if (!dayjs.isDayjs(value) || !value.isValid()) return null;
  try {
    return normalizeTrainingLocalDate(
      `${value.year()}-${`${value.month() + 1}`.padStart(2, '0')}-${`${value.date()}`.padStart(2, '0')}`,
    );
  } catch {
    return null;
  }
}

@Component({
  selector: 'app-training-workout-duplicate-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDatepickerModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatIconModule, AppChartSharedModule],
  providers: [
    { provide: DateAdapter, useFactory: (locale: string, data: TrainingWorkoutDuplicateDialogData) =>
      new TrainingDuplicateDateAdapter(locale, data.startOfWeek), deps: [MAT_DATE_LOCALE, MAT_DIALOG_DATA] },
    { provide: MAT_DATE_FORMATS, useValue: MAT_DAYJS_DATE_FORMATS },
  ],
  templateUrl: './training-workout-duplicate-dialog.component.html',
  styleUrls: ['./training-workout-duplicate-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingWorkoutDuplicateDialogComponent {
  readonly data = inject<TrainingWorkoutDuplicateDialogData>(MAT_DIALOG_DATA);
  readonly haptics = inject(AppHapticsService);
  private readonly dialogRef = inject(MatDialogRef<TrainingWorkoutDuplicateDialogComponent, string | undefined>);
  readonly selected = signal<Dayjs | null>(dayjs(this.data.localDate));

  readonly localDate = computed(() => duplicateWorkoutLocalDate(this.selected()));
  readonly extendsPlan = computed(() => {
    const date = this.localDate();
    const range = this.data.planRange;
    return !!date && !!range && (date < range.startLocalDate || date > range.endLocalDate);
  });

  setDate(value: Dayjs | null): void { this.selected.set(value); }
  confirm(): void {
    const date = this.localDate();
    if (date) this.dialogRef.close(date);
  }
}
