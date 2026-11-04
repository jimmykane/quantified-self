import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MaterialModule } from '../../modules/material.module';
import { AppPushService } from '../../services/app.push.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppNotificationPreferencesService } from '../../services/app.notification-preferences.service';
import type { MatSlideToggle } from '@angular/material/slide-toggle';
import type { NotificationCategoryId } from '@shared/notification-categories';
const STATUS = {
  loading: 'Checking notification support…', 'signed-out': 'Sign in to manage notifications.',
  unsupported: 'This browser does not support device notifications.',
  'install-required': 'On iPhone or iPad, add Quantified Self to your Home Screen, open it there, then enable notifications.',
  unavailable: 'Notifications are currently unavailable. Please try again later.',
  impersonating: 'Notifications cannot be managed while viewing another account.',
  denied: 'Notifications are blocked. Allow them in your browser or device settings, then return here.',
  disabled: 'Notifications are off on this device.', enabled: 'Notifications are enabled on this device.',
};
@Component({
  selector: 'app-push-notification-settings', standalone: true, imports: [MaterialModule],
  templateUrl: './push-notification-settings.component.html', styleUrls: ['./push-notification-settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PushNotificationSettingsComponent {
  readonly push = inject(AppPushService);
  readonly preferences = inject(AppNotificationPreferencesService);
  private readonly haptics = inject(AppHapticsService);
  readonly status = computed(() => STATUS[this.push.state()]);
  async setCategory(category: NotificationCategoryId, enabled: boolean, toggle?: MatSlideToggle): Promise<void> {
    // Material toggles before emitting change; retain the saved value until the write is acknowledged.
    if (toggle) toggle.checked = this.preferences.isEnabled(category);
    if (!this.preferences.canEdit() || this.preferences.isEnabled(category) === enabled) return;
    this.haptics.selection();
    try { if (await this.preferences.setEnabled(category, enabled)) this.haptics.success(); }
    catch { this.haptics.error(); }
  }
  retryCategories(): void {
    if (this.preferences.status() !== 'error') return;
    this.haptics.selection(); this.preferences.reload();
  }
  async act(action: 'enable' | 'disable' | 'test'): Promise<void> {
    if (!(action === 'enable' ? this.push.canEnable() : action === 'disable' ? this.push.canDisable() : this.push.canTest())) return;
    this.haptics.selection();
    try {
      const accepted = await (action === 'test' ? this.push.sendTest() : this.push[action]());
      if (accepted === false) this.haptics.error(); else this.haptics.success();
    }
    catch { this.haptics.error(); }
  }
}
