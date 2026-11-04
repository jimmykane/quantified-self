import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationOfferComponent } from './notification-offer.component';
import { AppPushService } from '../../services/app.push.service';
import { AppNotificationInvitationService } from '../../services/app.notification-invitation.service';
import { AppNotificationPreferencesService } from '../../services/app.notification-preferences.service';
import { AppRemoteConfigService } from '../../services/app.remote-config.service';
import { AppHapticsService } from '../../services/app.haptics.service';

const push = { state: signal('disabled'), operation: signal(null), canEnable: signal(true), canInvite: signal(true), enable: vi.fn() };
const invitation = { uid: signal<string | null>('owner'), due: signal(true), saving: signal(false), choose: vi.fn() };
const preferences = { status: signal('ready'), categories: signal([{ enabled: true }]), isEnabled: vi.fn() };
const config = { webPushActivitySyncEnabled: signal(true) };
const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
beforeEach(async () => {
  vi.clearAllMocks(); push.state.set('disabled'); push.operation.set(null); push.canEnable.set(true); push.canInvite.set(true);
  push.enable.mockResolvedValue(undefined); invitation.uid.set('owner'); invitation.due.set(true); invitation.saving.set(false);
  invitation.choose.mockResolvedValue(true); preferences.status.set('ready'); preferences.categories.set([{ enabled: true }]);
  preferences.isEnabled.mockReturnValue(true); config.webPushActivitySyncEnabled.set(true);
  await TestBed.configureTestingModule({ imports: [NotificationOfferComponent], providers: [provideRouter([]), provideNoopAnimations(),
    { provide: AppPushService, useValue: push }, { provide: AppNotificationInvitationService, useValue: invitation },
    { provide: AppNotificationPreferencesService, useValue: preferences }, { provide: AppRemoteConfigService, useValue: config },
    { provide: AppHapticsService, useValue: haptics },
  ] }).compileComponents();
});
function render(placement: 'tray' | 'dashboard' = 'tray') {
  const fixture = TestBed.createComponent(NotificationOfferComponent);
  fixture.componentRef.setInput('placement', placement); fixture.componentRef.setInput('ownerUid', 'owner'); fixture.detectChanges();
  return fixture;
}
function button(fixture, label: string): HTMLButtonElement {
  return Array.from(fixture.nativeElement.querySelectorAll('button')).find((element: HTMLElement) => element.textContent.includes(label)) as HTMLButtonElement;
}
describe('notification discovery surfaces', () => {
  it('renders the shared dashboard prompt silently and invokes enable directly from its button', async () => {
    const fixture = render('dashboard');
    expect(fixture.nativeElement.querySelector('app-dashboard-action-prompt')).toBeTruthy();
    expect(push.enable).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    button(fixture, 'Enable on this device').click(); expect(push.enable).toHaveBeenCalledOnce();
    await fixture.whenStable(); expect(haptics.success).toHaveBeenCalledOnce();
  });
  it.each(['dismissed', 'category off', 'sender off', 'legacy permission', 'other dashboard', 'signed out'])('suppresses the dashboard offer for %s', reason => {
    if (reason === 'dismissed') invitation.due.set(false);
    if (reason === 'category off') preferences.isEnabled.mockReturnValue(false);
    if (reason === 'sender off') config.webPushActivitySyncEnabled.set(false);
    if (reason === 'legacy permission') push.canInvite.set(false);
    if (reason === 'signed out') invitation.uid.set(null);
    const fixture = render('dashboard');
    if (reason === 'other dashboard') { fixture.componentRef.setInput('ownerUid', 'someone-else'); fixture.detectChanges(); }
    expect(fixture.nativeElement.querySelector('app-dashboard-action-prompt')).toBeNull();
    expect(push.enable).not.toHaveBeenCalled();
  });
  it('keeps permanent tray access after a dashboard dismissal', () => {
    invitation.due.set(false); push.canInvite.set(false);
    const fixture = render(); expect(button(fixture, 'Enable on this device')).toBeTruthy();
  });
  it('stores a snooze or permanent dismissal without changing browser/category permission', async () => {
    const fixture = render('dashboard');
    button(fixture, 'Not now').click(); await fixture.whenStable();
    expect(invitation.choose).toHaveBeenCalledWith('snoozed', 'owner');
    button(fixture, 'Don’t ask again').click(); await fixture.whenStable();
    expect(invitation.choose).toHaveBeenCalledWith('dismissed', 'owner'); expect(push.enable).not.toHaveBeenCalled();
  });
  it('keeps the offer stable while enabling and rejects repeated clicks', async () => {
    let finish!: () => void;
    push.enable.mockImplementation(() => { push.operation.set('enable'); return new Promise<void>(resolve => { finish = resolve; }); });
    const fixture = render('dashboard'); button(fixture, 'Enable on this device').click(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Enabling…');
    expect(button(fixture, 'Enabling…').disabled).toBe(true); await fixture.componentInstance.enable();
    expect(push.enable).toHaveBeenCalledOnce(); push.operation.set(null); finish(); await fixture.whenStable();
  });
  it('shows actionable blocked instructions only after a click', () => {
    push.state.set('denied'); push.canEnable.set(false); push.canInvite.set(false);
    const fixture = render(); expect(button(fixture, 'Enable on this device')).toBeUndefined();
    expect(fixture.nativeElement.querySelector('#notification-permission-instructions')).toBeNull();
    button(fixture, 'Show instructions').click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#notification-permission-instructions').textContent).toContain('site’s permissions');
    expect(push.enable).not.toHaveBeenCalled(); expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('explains installation and distinguishes disabled categories from enabled device permission', () => {
    push.state.set('install-required'); push.canEnable.set(false);
    const fixture = render(); button(fixture, 'Show instructions').click(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Share → Add to Home Screen');
    push.state.set('enabled'); preferences.categories.set([{ enabled: false }]); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your notification categories are off.');
    expect(fixture.nativeElement.textContent).toContain('Manage notifications');
  });
  it('does not play completion feedback for an account that changed during a permission request', async () => {
    let finish!: () => void; push.enable.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const fixture = render(); button(fixture, 'Enable on this device').click(); invitation.uid.set('next'); finish();
    await fixture.whenStable(); expect(haptics.success).not.toHaveBeenCalled(); expect(haptics.error).not.toHaveBeenCalled();
  });
  it('explains category read failures without presenting a false off state or endless loading', () => {
    push.state.set('enabled'); preferences.status.set('error');
    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('Could not load your notification categories');
    expect(fixture.nativeElement.textContent).not.toContain('Checking categories');
    expect(fixture.nativeElement.querySelector('a').textContent).toContain('Manage notifications');
  });
  it('displays failed saves and allows retry', async () => {
    invitation.choose.mockResolvedValue(false); const fixture = render('dashboard');
    button(fixture, 'Not now').click(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Could not save this choice'); expect(haptics.error).toHaveBeenCalledOnce();
  });
  it('clears account-specific UI and does not let an old request clear the new account’s pending action', async () => {
    const fixture = render();
    fixture.componentInstance.error.set('Previous account error'); fixture.componentInstance.instructionsOpen.set(true);
    let finishOld!: () => void, finishNew!: () => void;
    push.enable.mockReturnValueOnce(new Promise<void>(resolve => { finishOld = resolve; }))
      .mockReturnValueOnce(new Promise<void>(resolve => { finishNew = resolve; }));
    const oldRequest = fixture.componentInstance.enable();
    invitation.uid.set('next'); fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe(''); expect(fixture.componentInstance.instructionsOpen()).toBe(false);
    const newRequest = fixture.componentInstance.enable();
    finishOld(); await oldRequest;
    expect(fixture.componentInstance.busy()).toBe(true); expect(haptics.success).not.toHaveBeenCalled();
    finishNew(); await newRequest; expect(fixture.componentInstance.busy()).toBe(false);
  });
  it('emits navigation once and leaves route handling to the link', () => {
    const fixture = render(); const listener = vi.fn(); fixture.componentInstance.navigated.subscribe(listener);
    fixture.componentInstance.manage(); expect(listener).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledOnce();
  });
});
