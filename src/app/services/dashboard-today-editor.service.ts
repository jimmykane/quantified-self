import { DestroyRef, Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import type { AppUserInterface } from '../models/app-user.interface';
import { AppUserService } from './app.user.service';
import { AppHapticsService } from './app.haptics.service';
import { LoggerService } from './logger.service';

@Injectable({ providedIn: 'root' })
export class DashboardTodayEditorService {
  private readonly dialog = inject(MatDialog);
  private readonly users = inject(AppUserService);
  private readonly haptics = inject(AppHapticsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly logger = inject(LoggerService);
  private opening = false;
  async open(user: AppUserInterface, origin: DestroyRef): Promise<boolean> {
    if (origin.destroyed || this.opening || !user?.uid || this.users.user()?.uid !== user.uid)
      return false;
    this.opening = true;
    const ownerUid = user.uid;
    const isCurrent = () => !origin.destroyed && this.users.user()?.uid === ownerUid;
    this.haptics.selection();
    try {
      const { DashboardTodayEditorComponent } = await import(
        '../components/summaries/today/dashboard-today-editor.component'
      );
      if (!isCurrent()) return false;
      const ref = this.dialog.open(DashboardTodayEditorComponent, {
        data: user,
        width: '640px',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100dvh - 24px)',
      });
      const removeDestroy = origin.onDestroy(() => ref.close(false));
      try {
        const saved = await firstValueFrom(ref.afterClosed());
        return saved === true && isCurrent();
      } finally {
        removeDestroy();
      }
    } catch (error) {
      if (isCurrent()) {
        this.logger.error('[DashboardTodayEditor] Failed to open editor', error);
        this.snackBar.open(
          'Couldn’t open Customize Today. Please try again.',
          'Dismiss',
          { duration: 6000 }
        );
        this.haptics.error();
      }
      return false;
    } finally {
      this.opening = false;
    }
  }
}
