import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PushNotificationSettingsComponent } from './push-notification-settings.component';
import { By } from '@angular/platform-browser';
import { NOTIFICATION_CATEGORIES } from '@shared/notification-categories';
import { AppNotificationPreferencesService } from '../../services/app.notification-preferences.service';
import { AppPushService } from '../../services/app.push.service';
import { AppHapticsService } from '../../services/app.haptics.service';
const push = { state: signal('disabled'), operation: signal<string | null>(null), message: signal(''), registered: signal(false),
  canEnable: signal(true), canDisable: signal(false), canTest: signal(false), enable: vi.fn(), disable: vi.fn(), sendTest: vi.fn() };
const categoryEnabled = signal(true);
const preferences = { status: signal('ready'), saving: signal<string | null>(null), message: signal(''), canEdit: signal(true),
  categories: computed(() => NOTIFICATION_CATEGORIES.map(category => ({ ...category, enabled: categoryEnabled() }))),
  isEnabled: () => categoryEnabled(), setEnabled: vi.fn(), reload: vi.fn() };
const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks(); categoryEnabled.set(true); preferences.status.set('ready'); preferences.saving.set(null);
  preferences.message.set(''); preferences.canEdit.set(true); preferences.setEnabled.mockResolvedValue(true);
  push.state.set('disabled'); push.operation.set(null); push.message.set(''); push.registered.set(false);
  push.canEnable.set(true); push.canDisable.set(false); push.canTest.set(false); push.enable.mockResolvedValue(undefined);
  TestBed.configureTestingModule({ imports: [PushNotificationSettingsComponent], providers: [
    { provide: AppNotificationPreferencesService, useValue: preferences },
    { provide: AppPushService, useValue: push }, { provide: AppHapticsService, useValue: haptics },
  ] });
});
describe('notification Settings', () => {
  it('renders real controls and stays silent on initialization', () => {
    const fixture = TestBed.createComponent(PushNotificationSettingsComponent); fixture.detectChanges();
    const buttons = [...fixture.nativeElement.querySelectorAll('.notification-actions button')] as HTMLButtonElement[];
    expect(buttons.map(b => b.textContent)).toEqual([expect.stringContaining('Enable on this device'), expect.stringContaining('Send test notification')]);
    expect(buttons[0].disabled).toBe(false); expect(buttons[1].disabled).toBe(true); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('renders the default-on category and keeps its saved state while a change is pending or fails', async () => {
    const fixture = TestBed.createComponent(PushNotificationSettingsComponent); fixture.detectChanges();
    const toggle = fixture.debugElement.query(By.css('mat-slide-toggle')).componentInstance;
    expect(toggle.checked).toBe(true); expect(toggle.disabled).toBe(false);
    expect(fixture.debugElement.queryAll(By.css('mat-slide-toggle'))).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('New activities synced');
    expect(fixture.nativeElement.textContent).toContain('History imports are excluded');
    expect(fixture.nativeElement.textContent).toContain('New categories are on by default');
    let reject!: (error: Error) => void;
    preferences.setEnabled.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
    toggle.checked = false;
    const pending = fixture.componentInstance.setCategory('history_import', false, toggle);
    expect(toggle.checked).toBe(true); expect(preferences.setEnabled).toHaveBeenCalledWith('history_import', false);
    preferences.saving.set('history_import'); preferences.canEdit.set(false); fixture.detectChanges();
    expect(toggle.disabled).toBe(true); expect(fixture.nativeElement.textContent).toContain('Saving category preference');
    reject(new Error('failed')); await pending;
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.error).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled(); expect(toggle.checked).toBe(true);
  });
  it('gives category feedback only for accepted actions and successful writes', async () => {
    const fixture = TestBed.createComponent(PushNotificationSettingsComponent);
    await fixture.componentInstance.setCategory('history_import', true);
    expect(haptics.selection).not.toHaveBeenCalled();
    await fixture.componentInstance.setCategory('history_import', false);
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.success).toHaveBeenCalledOnce();
    haptics.success.mockClear(); preferences.setEnabled.mockResolvedValueOnce(false);
    await fixture.componentInstance.setCategory('history_import', false); expect(haptics.success).not.toHaveBeenCalled();
    preferences.canEdit.set(false); preferences.setEnabled.mockClear();
    await fixture.componentInstance.setCategory('history_import', false); expect(preferences.setEnabled).not.toHaveBeenCalled();
  });
  it('offers an explicit category reload after a read error', () => {
    const fixture = TestBed.createComponent(PushNotificationSettingsComponent);
    fixture.componentInstance.retryCategories(); expect(haptics.selection).not.toHaveBeenCalled();
    preferences.status.set('error'); preferences.canEdit.set(false); fixture.detectChanges();
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((item: HTMLButtonElement) => item.textContent.includes('Retry category')) as HTMLButtonElement;
    button.click(); expect(preferences.reload).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledOnce();
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
