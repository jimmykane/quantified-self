import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MaterialModule } from '../../modules/material.module';
import { AppPushService } from '../../services/app.push.service';
import { AppHapticsService } from '../../services/app.haptics.service';
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
  private readonly haptics = inject(AppHapticsService);
  readonly status = computed(() => STATUS[this.push.state()]);
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
