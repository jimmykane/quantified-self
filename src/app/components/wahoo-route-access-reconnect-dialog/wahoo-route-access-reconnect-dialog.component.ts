import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ServiceNames } from '@sports-alliance/sports-lib';
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

  readonly reconnecting = signal(false);

  async reconnect(): Promise<void> {
    if (this.reconnecting()) {
      return;
    }

    this.reconnecting.set(true);
    try {
      this.analyticsService.logEvent('service_reconnect_start', {
        service_name: ServiceNames.WahooAPI,
        source: 'route_access_dialog',
      });
      const tokenAndURI = await this.userService.getCurrentUserServiceTokenAndRedirectURI(ServiceNames.WahooAPI);
      this.windowService.windowRef.location.href = tokenAndURI.redirect_uri;
    } catch (error) {
      this.reconnecting.set(false);
      this.logger.error('[WahooRouteAccessReconnectDialogComponent] Failed to start Wahoo reconnect', error);
      this.snackBar.open('Could not start Wahoo reconnect. Please try again.', undefined, { duration: 5000 });
    }
  }
}
