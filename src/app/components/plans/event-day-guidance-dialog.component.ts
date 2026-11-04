import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import type { DailyWorkoutEventAdviceV1 } from '@shared/daily-workout-suggestion';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppUserService } from '../../services/app.user.service';
@Component({ selector: 'app-event-day-guidance-dialog', standalone: true, imports: [MatDialogModule, MatButtonModule, AppChartSharedModule],
  templateUrl: './event-day-guidance-dialog.component.html', styleUrl: './day-workout-dialog.component.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class EventDayGuidanceDialogComponent {
  readonly data = inject<{ uid: string; advice: DailyWorkoutEventAdviceV1 }>(MAT_DIALOG_DATA);
  private readonly users = inject(AppUserService);
  private readonly ref = inject(MatDialogRef<EventDayGuidanceDialogComponent>);
  constructor() { effect(() => { if (this.users.user()?.uid !== this.data.uid) this.ref.close(); }); }
}
