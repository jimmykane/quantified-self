import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { InactivityAdminResponse } from '@shared/admin-inactivity';
import { AdminInactiveAccountsComponent } from './admin-inactive-accounts.component';
import { AdminInactivityService } from '../../../services/admin-inactivity.service';
import { AppHapticsService } from '../../../services/app.haptics.service';

function response(): InactivityAdminResponse {
  return { settings: { mode: 'off', warningDailyLimit: 100, deletionDailyLimit: 25, revision: 2 }, settingsValid: true,
    running: false, lastStartedAt: null, lastFinishedAt: null, lastScanCompletedAt: null, budgetDay: '2026-11-14',
    warningsReserved: 0, deletionsReserved: 0, lastRun: null, nextUid: 'synthetic',
    accounts: [{ uid: 'synthetic', email: 'synthetic@example.invalid', authPresent: true,
      queuedAt: Date.UTC(2026, 10, 14), acceptedAt: null, deleteAfter: null, requestedAt: null, detail: 'Awaiting confirmed warning delivery.' }] };
}
async function setup() {
  let ownerChanged!: (uid: string | null) => void;
  const unwatch = vi.fn();
  const service = { currentUid: () => 'admin', watchOwner: vi.fn(callback => { ownerChanged = callback; return unwatch; }),
    read: vi.fn().mockResolvedValue(response()), save: vi.fn().mockResolvedValue(undefined) };
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const dialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(true), close: vi.fn() }) };
  await TestBed.configureTestingModule({ imports: [AdminInactiveAccountsComponent, NoopAnimationsModule], providers: [provideRouter([]),
    { provide: AdminInactivityService, useValue: service }, { provide: AppHapticsService, useValue: haptics }] })
    .overrideProvider(MatDialog, { useValue: dialog }).compileComponents();
  const fixture = TestBed.createComponent(AdminInactiveAccountsComponent);
  const component = fixture.componentInstance;
  return { fixture, component, service, haptics, dialog, unwatch, ownerChanged: (uid: string | null) => ownerChanged(uid) };
}
async function render() {
  const context = await setup(); context.fixture.detectChanges(); await context.fixture.whenStable(); context.fixture.detectChanges(); return context;
}
describe('Admin inactive accounts route', () => {
  it('renders the dedicated workspace, account state and safe default without feedback or writes', async () => {
    const { fixture, component, service, haptics } = await render();
    expect(fixture.nativeElement.querySelector('main.qs-workspace-page')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Inactive accounts');
    expect(fixture.nativeElement.textContent).toContain('synthetic@example.invalid');
    expect(fixture.nativeElement.textContent).toContain('No run summary recorded yet');
    expect(component.mode()).toBe('off'); expect(component.canSave()).toBeFalsy();
    expect(service.save).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('binds numeric controls, validates caps and resets edits', async () => {
    const { fixture, component, haptics } = await render();
    const input = fixture.nativeElement.querySelector('input');
    input.value = '101'; input.dispatchEvent(new Event('input')); fixture.detectChanges(); await fixture.whenStable();
    expect(component.warningLimit()).toBe(101); expect(component.canSave()).toBeFalsy();
    input.value = '10'; input.dispatchEvent(new Event('input')); fixture.detectChanges(); await fixture.whenStable();
    expect(component.canSave()).toBeTruthy(); expect(haptics.selection).not.toHaveBeenCalled();
    component.reset(); expect(component.warningLimit()).toBe(100); expect(haptics.selection).toHaveBeenCalledTimes(1);
  });
  it('requires explicit confirmation for enforcement and reports a successful save', async () => {
    const { component, service, dialog, haptics } = await render();
    component.changeMode('enforce');
    const updated = response(); updated.settings = { ...updated.settings, mode: 'enforce', revision: 3 }; service.read.mockResolvedValue(updated);
    await component.save();
    expect(dialog.open.mock.calls[0][1].data).toMatchObject({ title: 'Enable account deletion?', confirmColor: 'warn' });
    expect(dialog.open.mock.calls[0][1].data.message).toContain('Existing elapsed notices');
    expect(service.save).toHaveBeenCalledWith({ mode: 'enforce', warningDailyLimit: 100, deletionDailyLimit: 25, revision: 2 }, 'admin');
    expect(haptics.success).toHaveBeenCalledTimes(1); expect(component.dirty()).toBe(false);
  });
  it('keeps cancellation and unchanged selections free of writes and success feedback', async () => {
    const { component, service, dialog, haptics } = await render();
    component.changeMode('off'); await component.save(); expect(haptics.selection).not.toHaveBeenCalled();
    component.changeMode('warnings-only'); dialog.open.mockReturnValue({ afterClosed: () => of(false), close: vi.fn() });
    await component.save(); expect(service.save).not.toHaveBeenCalled(); expect(haptics.success).not.toHaveBeenCalled();
    expect(component.saving()).toBe(false);
  });
  it('does not silently overwrite another admin settings revision while browsing pages', async () => {
    const { component, service } = await render();
    component.changeMode('warnings-only'); const updated = response(); updated.settings.revision = 3; service.read.mockResolvedValue(updated);
    component.next(); await Promise.resolve(); await Promise.resolve();
    expect(component.mode()).toBe('warnings-only'); expect(component.baseline()?.revision).toBe(2);
    expect(component.conflict()).toBe(true); expect(component.canSave()).toBeFalsy();
  });
  it('paginates and resets the cursor when changing views', async () => {
    const { fixture, component, service } = await render();
    component.next(); await fixture.whenStable(); expect(service.read).toHaveBeenLastCalledWith({ view: 'queued', afterUid: 'synthetic' });
    component.previous(); await fixture.whenStable(); expect(service.read).toHaveBeenLastCalledWith({ view: 'queued' });
    component.changeView('pending-deletion'); await fixture.whenStable();
    expect(service.read).toHaveBeenLastCalledWith({ view: 'pending-deletion' }); expect(component.page()).toBe(1);
  });
  it('shows read failures without implying an empty queue and permits refresh', async () => {
    const { fixture, component, service, haptics } = await setup();
    service.read.mockRejectedValueOnce(new Error('synthetic')); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Unable to load');
    expect(fixture.nativeElement.textContent).not.toContain('No accounts in this view'); expect(haptics.error).not.toHaveBeenCalled();
    component.refresh(); await fixture.whenStable(); expect(component.data()).not.toBeNull();
  });
  it('reports a rejected save without retrying or claiming success', async () => {
    const { component, service, haptics } = await render();
    component.changeMode('dry-run'); service.save.mockRejectedValue(new Error('permission-denied')); await component.save();
    expect(service.save).toHaveBeenCalledTimes(1); expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(haptics.success).not.toHaveBeenCalled(); expect(component.error()).toContain('not confirmed saved');
  });
  it('clears private data and cancels a pending confirmation when the account changes', async () => {
    const { component, ownerChanged, service, dialog } = await render();
    const closed = new Subject<boolean>(); const close = vi.fn(); dialog.open.mockReturnValue({ afterClosed: () => closed, close });
    component.changeMode('enforce'); const saving = component.save(); ownerChanged('another-admin');
    expect(component.data()).toBeNull(); expect(close).toHaveBeenCalled(); closed.next(true); closed.complete(); await saving;
    expect(service.save).not.toHaveBeenCalled();
  });
  it('discards pending reads on destruction and releases the account subscription', async () => {
    const { fixture, component, service, unwatch } = await setup();
    let finish!: (value: InactivityAdminResponse) => void; service.read.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fixture.detectChanges(); fixture.destroy(); finish(response()); await Promise.resolve(); await Promise.resolve();
    expect(component.data()).toBeNull(); expect(unwatch).toHaveBeenCalledTimes(1);
  });
});
