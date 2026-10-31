import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { filter, take, takeUntil, tap } from 'rxjs';
import { TrainingDeliveryDialogComponent } from '../components/plans/training-delivery-dialog.component';
import { AppHapticsService } from './app.haptics.service';
import { AppUserService } from './app.user.service';

/** Owns the short-lived action across the editor-to-browse route change. It never sends a workout. */
@Injectable({ providedIn: 'root' })
export class TrainingWorkoutAddedService {
  private readonly users = inject(AppUserService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroy = inject(DestroyRef);

  show(message: string, workout: { id: string; title: string } | null): void {
    const uid = this.users.user()?.uid;
    if (!uid) return;
    const notice = this.snackBar.open(message, workout ? 'Send / sync' : 'Dismiss', { duration: 8000 });
    if (!workout) return;
    notice.onAction().pipe(take(1), takeUntil(this.users.user$.pipe(
      filter(user => user?.uid !== uid), tap(() => notice.dismiss()),
    )), takeUntilDestroyed(this.destroy)).subscribe(() => {
      if (this.users.user()?.uid !== uid) return;
      this.haptics.selection();
      this.dialog.open(TrainingDeliveryDialogComponent, {
        data: { scope: 'workout', id: workout.id, title: workout.title }, width: '640px', maxWidth: '95vw',
      });
    });
  }
}
