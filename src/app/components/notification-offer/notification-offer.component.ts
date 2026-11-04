import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { SharedModule } from '../../modules/shared.module';
import { AppPushService } from '../../services/app.push.service';
import { AppNotificationInvitationService } from '../../services/app.notification-invitation.service';
import { AppNotificationPreferencesService } from '../../services/app.notification-preferences.service';
import { AppRemoteConfigService } from '../../services/app.remote-config.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import type { DashboardActionPromptViewModel } from '../../helpers/dashboard-action-prompt.helper';

@Component({
  selector: 'app-notification-offer', standalone: true, imports: [SharedModule],
  templateUrl: './notification-offer.component.html', styleUrl: './notification-offer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationOfferComponent {
  readonly placement = input<'dashboard' | 'tray'>('tray');
  readonly ownerUid = input<string | null>(null);
  readonly navigated = output<void>();
  readonly push = inject(AppPushService);
  readonly invitation = inject(AppNotificationInvitationService);
  readonly preferences = inject(AppNotificationPreferencesService);
  private readonly config = inject(AppRemoteConfigService);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroy = inject(DestroyRef);
  private readonly workingFor = signal<string | null>(null);
  readonly error = signal('');
  readonly instructionsOpen = signal(false);
  readonly busy = computed(() => !!this.push.operation() || this.invitation.saving() || !!this.workingFor());
  readonly visible = computed(() => {
    const uid = this.invitation.uid();
    if (!uid || this.push.state() === 'impersonating' || this.push.state() === 'signed-out') return false;
    if (this.placement() === 'tray') return true;
    if (this.ownerUid() !== uid) return false;
    // Permission and registration state can change before this gesture finishes. Keep
    // its progress/error visible even when the device is no longer eligible for an invitation.
    if (this.workingFor() === uid || this.error()) return true;
    return this.config.webPushActivitySyncEnabled()
      && this.preferences.isEnabled('activity_sync')
      && this.push.canInvite() && this.invitation.due();
  });
  readonly status = computed(() => {
    switch (this.push.state()) {
      case 'enabled': return this.preferences.status() === 'error' ? 'Enabled on this device. Could not load your notification categories.'
        : this.preferences.status() !== 'ready' ? 'Enabled on this device. Checking categories…'
        : this.preferences.categories().some(category => category.enabled) ? 'Enabled on this device.' : 'Your notification categories are off.';
      case 'disabled': return 'Notifications are off on this device.';
      case 'denied': return 'Notifications are blocked by your browser.';
      case 'install-required': return 'Open QS from your Home Screen to enable notifications.';
      case 'unsupported': return 'This browser does not support device notifications.';
      case 'unavailable': return 'Notifications are currently unavailable. Please try again later.';
      default: return 'Checking notification support…';
    }
  });
  readonly prompt = computed<DashboardActionPromptViewModel>(() => ({
    id: 'enableNotifications', icon: 'notifications', title: 'Know when your activities arrive',
    description: 'Get grouped alerts for newly synced activities and activity delivery updates. History imports won’t generate an alert for every activity.',
    busy: this.busy(), error: this.error(),
    primaryAction: { id: 'enableNotifications', label: 'Enable on this device', loadingLabel: this.push.operation() === 'enable' ? 'Enabling…' : 'Saving…',
      disabled: !this.push.canEnable() },
    secondaryAction: { id: 'snoozeNotifications', label: 'Not now' },
    menuActions: [{ id: 'dismissNotifications', label: 'Don’t ask again' }],
  }));

  constructor() {
    effect(() => {
      this.invitation.uid();
      untracked(() => {
        this.error.set(''); this.instructionsOpen.set(false); this.workingFor.set(null);
      });
    });
  }

  private current(uid: string): boolean { return !this.destroy.destroyed && this.invitation.uid() === uid; }
  async enable(): Promise<void> {
    const uid = this.invitation.uid();
    if (!uid || !this.push.canEnable() || this.busy()) return;
    this.error.set(''); this.workingFor.set(uid); this.haptics.selection();
    try {
      // Keep the permission request in this click's synchronous call stack.
      await this.push.enable();
      if (this.current(uid)) this.haptics.success();
    } catch {
      if (this.current(uid)) { this.error.set('Could not enable notifications. Check permission and try again.'); this.haptics.error(); }
    } finally { if (!this.destroy.destroyed && this.workingFor() === uid) this.workingFor.set(null); }
  }
  async dismiss(permanent: boolean): Promise<void> {
    const uid = this.invitation.uid();
    if (!uid || this.busy()) return;
    this.error.set(''); this.workingFor.set(uid); this.haptics.selection();
    const saved = await this.invitation.choose(permanent ? 'dismissed' : 'snoozed', uid);
    if (this.current(uid)) {
      if (saved) this.haptics.success();
      else { this.error.set('Could not save this choice. Please try again.'); this.haptics.error(); }
    }
    if (!this.destroy.destroyed && this.workingFor() === uid) this.workingFor.set(null);
  }
  toggleInstructions(): void {
    if (this.busy()) return;
    this.instructionsOpen.update(value => !value); this.haptics.selection();
  }
  manage(): void { this.haptics.selection(); this.navigated.emit(); }
}
