import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TrainingLoadSettingsComponent } from './training-load-settings.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppUserService } from '../../services/app.user.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';

/** Health and Training use the same dated policy editor and persistence service. */
@Component({ selector: 'app-training-thresholds-dialog', standalone: true,
  imports: [MatDialogModule, MatButtonModule, TrainingLoadSettingsComponent],
  template: `<h2 mat-dialog-title>Training thresholds</h2>
    <mat-dialog-content><app-training-load-settings [uid]="data.uid" [unitSettings]="data.unitSettings" [thresholdsOnly]="true" /></mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-button type="button" (click)="close()">Close</button></mat-dialog-actions>`,
  changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingThresholdsDialogComponent {
  readonly data = inject<{ uid: string; unitSettings?: UserUnitSettingsInterface }>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<TrainingThresholdsDialogComponent>);
  private readonly haptics = inject(AppHapticsService);
  constructor() {
    inject(AppUserService).user$.pipe(takeUntilDestroyed()).subscribe(user => {
      if (user?.uid !== this.data.uid) this.dialog.close();
    });
  }
  close(): void { this.haptics.selection(); this.dialog.close(); }
}
