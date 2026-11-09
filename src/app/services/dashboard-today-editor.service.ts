import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import type { AppUserInterface } from '../models/app-user.interface';
import { AppUserService } from './app.user.service';
import { AppHapticsService } from './app.haptics.service';

@Injectable({ providedIn: 'root' })
export class DashboardTodayEditorService {
  private readonly dialog = inject(MatDialog);
  private readonly users = inject(AppUserService);
  private readonly haptics = inject(AppHapticsService);
  private opening = false;
  async open(user: AppUserInterface): Promise<boolean> {
    if (this.opening || !user?.uid || this.users.user()?.uid !== user.uid)
      return false;
    this.opening = true;
    this.haptics.selection();
    try {
      const { DashboardTodayEditorComponent } = await import(
        '../components/summaries/today/dashboard-today-editor.component'
      );
      if (this.users.user()?.uid !== user.uid) return false;
      return (
        (await firstValueFrom(
          this.dialog
            .open(DashboardTodayEditorComponent, {
              data: user,
              width: '640px',
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'calc(100dvh - 24px)',
            })
            .afterClosed()
        )) === true
      );
    } finally {
      this.opening = false;
    }
  }
}
