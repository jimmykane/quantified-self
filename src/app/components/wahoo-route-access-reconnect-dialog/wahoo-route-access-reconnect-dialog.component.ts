import { Component, DestroyRef, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppUserService } from '../../services/app.user.service';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-wahoo-route-access-reconnect-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, MatProgressSpinnerModule],
  templateUrl: './wahoo-route-access-reconnect-dialog.component.html',
  styleUrls: ['./wahoo-route-access-reconnect-dialog.component.scss'],
})
export class WahooRouteAccessReconnectDialogComponent {
  private userService = inject(AppUserService);
  private windowService = inject(AppWindowService);
  private analyticsService = inject(AppAnalyticsService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  private destroyRef = inject(DestroyRef);
  private dialogRef = inject<MatDialogRef<WahooRouteAccessReconnectDialogComponent>>(MatDialogRef, { optional: true });
  readonly haptics = inject(AppHapticsService);

  readonly reconnecting = signal(false);

  async reconnect(): Promise<void> {
    if (this.reconnecting() || !this.isActive()) {
      return;
    }

    this.reconnecting.set(true);
    this.haptics.selection();
    try {
      this.analyticsService.logEvent('service_reconnect_start', {
        service_name: ServiceNames.WahooAPI,
        source: 'route_access_dialog',
      });
      const tokenAndURI = await this.userService.getCurrentUserServiceTokenAndRedirectURI(ServiceNames.WahooAPI);
      if (this.isActive()) {
        this.windowService.windowRef.location.href = tokenAndURI.redirect_uri;
      }
    } catch (error) {
      this.reconnecting.set(false);
      this.logger.error('[WahooRouteAccessReconnectDialogComponent] Failed to start Wahoo reconnect', error);
      if (this.isActive()) {
        this.haptics.error();
        this.snackBar.open('Could not start Wahoo reconnect. Please try again.', undefined, { duration: 5000 });
      }
    }
  }

  private isActive(): boolean {
    return !this.destroyRef.destroyed
      && (!this.dialogRef || this.dialogRef.getState() === MatDialogState.OPEN);
  }
}
