import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PushNotificationSettingsComponent } from './push-notification-settings.component';
import { AppPushService } from '../../services/app.push.service';
import { AppHapticsService } from '../../services/app.haptics.service';
const push = { state: signal('disabled'), operation: signal<string | null>(null), message: signal(''), registered: signal(false),
  canEnable: signal(true), canDisable: signal(false), canTest: signal(false), enable: vi.fn(), disable: vi.fn(), sendTest: vi.fn() };
const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks(); push.state.set('disabled'); push.operation.set(null); push.message.set(''); push.registered.set(false);
  push.canEnable.set(true); push.canDisable.set(false); push.canTest.set(false); push.enable.mockResolvedValue(undefined);
  TestBed.configureTestingModule({ imports: [PushNotificationSettingsComponent], providers: [
    { provide: AppPushService, useValue: push }, { provide: AppHapticsService, useValue: haptics },
  ] });
});
describe('notification Settings', () => {
  it('renders real controls and stays silent on initialization', () => {
    const fixture = TestBed.createComponent(PushNotificationSettingsComponent); fixture.detectChanges();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons.map(b => b.textContent)).toEqual([expect.stringContaining('Enable on this device'), expect.stringContaining('Send test notification')]);
    expect(buttons[0].disabled).toBe(false); expect(buttons[1].disabled).toBe(true); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('owns accepted-action feedback and reports async success/error exactly once', async () => {
    const fixture = TestBed.createComponent(PushNotificationSettingsComponent);
    await fixture.componentInstance.act('enable'); expect(push.enable).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.success).toHaveBeenCalledOnce();
    push.canTest.set(true); push.sendTest.mockRejectedValueOnce(new Error('failed'));
    await fixture.componentInstance.act('test'); expect(haptics.error).toHaveBeenCalledOnce();
    push.canEnable.set(false); await fixture.componentInstance.act('enable'); expect(push.enable).toHaveBeenCalledOnce();
  });
  it('does not give success feedback for an expired self-test registration', async () => {
    push.canTest.set(true); push.sendTest.mockResolvedValueOnce(false);
    const fixture = TestBed.createComponent(PushNotificationSettingsComponent);
    await fixture.componentInstance.act('test');
    expect(haptics.error).toHaveBeenCalledOnce(); expect(haptics.success).not.toHaveBeenCalled();
  });
  it('renders pending and blocked states with accessible status', () => {
    const fixture = TestBed.createComponent(PushNotificationSettingsComponent);
    push.registered.set(true); push.state.set('denied'); push.canEnable.set(false); push.operation.set('disable'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Notifications are blocked');
    expect(fixture.nativeElement.querySelector('mat-spinner')?.getAttribute('aria-label')).toBe('Disabling notifications');
    expect(fixture.nativeElement.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});
