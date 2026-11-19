import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { InactivityAdminRequest, InactivityAdminResponse, InactivityAdminView, InactivityLoginEntry } from '@shared/admin-inactivity';
import { AdminInactiveAccountsComponent } from './admin-inactive-accounts.component';
import { AdminInactivityService } from '../../../services/admin-inactivity.service';
import { AppHapticsService } from '../../../services/app.haptics.service';

function response(): InactivityAdminResponse {
  return { settings: { mode: 'off', warningDailyLimit: 100, deletionDailyLimit: 25, revision: 2 }, settingsValid: true,
    scanStatus: 'off', dailyLimitReached: false, running: false, lastStartedAt: null, lastFinishedAt: null, lastScanCompletedAt: null, budgetDay: '2026-11-14',
    warningsReserved: 0, deletionsReserved: 0, lastCompletedDryRun: null, lastRun: null, nextUid: 'synthetic',
    accounts: [{ uid: 'synthetic', email: 'synthetic@example.invalid', authPresent: true, eventCount: 0,
      queuedAt: Date.UTC(2026, 10, 14), acceptedAt: null, deleteAfter: null, requestedAt: null, detail: 'Awaiting confirmed warning delivery.' }] };
}
async function setup() {
  let ownerChanged!: (uid: string | null) => void;
  const unwatch = vi.fn();
  const entries: InactivityLoginEntry[] = Array.from({ length: 26 }, (_, i) => ({
    uid: i ? 'user-' + String(i).padStart(2, '0') : 'synthetic', lastLoginAt: Date.UTC(2024, 0, i + 1),
  }));
  const firstPage = entries.slice(0, 25).map(row => row.uid);
  const loadLoginOrder = vi.fn(async (_view: InactivityAdminView) => ({
    entries, snapshot: response(), dryRunId: undefined as string | undefined,
  }));
  const service = { currentUid: () => 'admin', watchOwner: vi.fn(callback => { ownerChanged = callback; return unwatch; }),
    loadLoginOrder, read: vi.fn(async (_request: InactivityAdminRequest) => response()), save: vi.fn().mockResolvedValue(undefined) };
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const dialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(true), close: vi.fn() }) };
  await TestBed.configureTestingModule({ imports: [AdminInactiveAccountsComponent, NoopAnimationsModule], providers: [provideRouter([]),
    { provide: AdminInactivityService, useValue: service }, { provide: AppHapticsService, useValue: haptics }] })
    .overrideProvider(MatDialog, { useValue: dialog }).compileComponents();
  const fixture = TestBed.createComponent(AdminInactiveAccountsComponent);
  const component = fixture.componentInstance;
  return { fixture, component, service, haptics, dialog, unwatch, entries, firstPage, ownerChanged: (uid: string | null) => ownerChanged(uid) };
}
async function render() {
  const context = await setup();
  context.fixture.detectChanges();
  await vi.waitFor(() => expect(context.component.rows()).toHaveLength(1));
  context.fixture.detectChanges();
  return context;
}
describe('Admin inactive accounts route', () => {
  it('renders the dedicated workspace, account state and safe default without feedback or writes', async () => {
    const { fixture, component, service, haptics } = await render();
    expect(fixture.nativeElement.querySelector('main.qs-workspace-page')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Inactive accounts');
    expect(fixture.nativeElement.textContent).toContain('synthetic@example.invalid');
    expect(fixture.nativeElement.textContent).toContain('No run summary recorded yet');
    expect(fixture.nativeElement.querySelector('.mode-toolbar button').textContent.trim()).toBe('Change mode');
    expect(fixture.nativeElement.querySelector('#retention-settings input')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('can queue one final reminder');
    expect(fixture.nativeElement.textContent).toContain('uses the original deletion deadline');
    expect(component.mode()).toBe('off'); expect(component.canSave()).toBeFalsy();
    expect(service.save).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('opens the published eligible list in dry run and preserves an explicitly chosen view on refresh', async () => {
    const { component, fixture, service, entries } = await setup();
    const snapshot = response();
    snapshot.settings.mode = 'dry-run'; snapshot.scanStatus = 'continuation-pending';
    snapshot.lastCompletedDryRun = { id: 'report', finishedAt: Date.UTC(2026, 10, 18), eligibleCount: 26 };
    service.read.mockResolvedValue(snapshot);
    service.loadLoginOrder.mockImplementation(async view => ({ entries, snapshot, dryRunId: view === 'eligible' ? 'report' : undefined }));
    fixture.detectChanges(); await vi.waitFor(() => expect(component.rows()).toHaveLength(1)); fixture.detectChanges();
    expect(service.read.mock.calls[0][0]).toEqual({ view: 'queued', accountUids: [] });
    expect(service.loadLoginOrder.mock.calls.map(([view]) => view)).toEqual(['eligible']);
    expect(fixture.nativeElement.querySelector('[aria-labelledby="retention-accounts"]').textContent).toContain('26 eligible');
    expect(fixture.nativeElement.querySelector('.scan-summary [role=status]').textContent).toContain('Continuation pending');
    expect(fixture.nativeElement.querySelector('mat-expansion-panel-header').getAttribute('aria-expanded')).toBe('false');
    component.changeView('warned'); await vi.waitFor(() => expect(component.accountsLoading()).toBe(false));
    component.refresh(); await vi.waitFor(() => expect(service.loadLoginOrder).toHaveBeenCalledTimes(3));
    expect(component.view()).toBe('warned');
  });
  it('opens the mode editor while the directory loads and saves during paging without reviving stale data', async () => {
    const { component, fixture, service, entries, dialog } = await setup();
    const old = response();
    let finishDirectory!: () => void;
    service.loadLoginOrder.mockImplementationOnce(() => new Promise(resolve => {
      finishDirectory = () => resolve({ entries, snapshot: old, dryRunId: undefined });
    }));
    fixture.detectChanges(); await vi.waitFor(() => expect(component.accountsLoading()).toBe(true)); fixture.detectChanges();
    const change = fixture.nativeElement.querySelector('.mode-toolbar button') as HTMLButtonElement;
    expect(change.disabled).toBe(false); change.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#retention-settings input').disabled).toBe(false);
    finishDirectory(); await vi.waitFor(() => expect(component.rows()).toHaveLength(1));
    let finishPage!: () => void;
    service.read.mockImplementationOnce(() => new Promise(resolve => { finishPage = () => resolve(old); }));
    component.next(); expect(component.accountsLoading()).toBe(true);
    component.changeMode('dry-run'); expect(component.canSave()).toBe(true);
    const updated = response(); updated.settings = { ...old.settings, mode: 'dry-run', revision: 3 };
    updated.lastCompletedDryRun = { id: 'new', finishedAt: Date.UTC(2026, 10, 19), eligibleCount: 1 };
    service.read.mockResolvedValue(updated);
    service.loadLoginOrder.mockResolvedValue({ entries: [entries[0]], snapshot: updated, dryRunId: 'new' });
    await component.save();
    expect(dialog.open.mock.calls[0][1].data.message).toContain('Change from Off to Dry run.');
    await vi.waitFor(() => expect(component.rows()).toHaveLength(1));
    finishPage(); await Promise.resolve(); await Promise.resolve();
    expect(component.data()?.settings).toEqual(updated.settings);
    expect(component.editing()).toBe(false); expect(component.view()).toBe('eligible'); expect(component.page()).toBe(1);
    expect(component.accountsError()).toBe('');
  });
  it('shows an action limit alongside scan progress and retains the last batch outcome', async () => {
    const { fixture, component, service } = await setup();
    const snapshot = response();
    snapshot.settings.mode = 'enforce'; snapshot.scanStatus = 'scanning'; snapshot.dailyLimitReached = true;
    snapshot.lastRun = { finishedAt: Date.UTC(2026, 10, 13), outcome: 'failed', queued: 0, accepted: 0,
      deletionRequested: 0, blocked: 0, failed: 0, noticeUnconfirmed: 0, overdue: 0, reviewRequired: 0, capped: false };
    service.read.mockResolvedValue(snapshot);
    fixture.detectChanges(); await vi.waitFor(() => expect(component.rows()).toHaveLength(1)); fixture.detectChanges();
    const summary = fixture.nativeElement.querySelector('.scan-summary');
    expect(summary.querySelector('[role=status]').textContent).toContain('Scanning');
    expect(summary.textContent).toContain('A daily limit deferred');
    summary.querySelector('mat-expansion-panel-header').click(); fixture.detectChanges();
    expect(summary.textContent).toContain('Last batch failed at');
  });
  it('isolates a page error and retries the same page without discarding the mode draft', async () => {
    const { component, fixture, service } = await render();
    component.toggleEditing(); component.changeMode('warnings-only');
    service.read.mockRejectedValueOnce(new Error('page unavailable'));
    component.next(); await vi.waitFor(() => expect(component.accountsError()).toContain('Unable to load accounts'));
    fixture.detectChanges();
    expect(component.error()).toBe(''); expect(component.canSave()).toBe(true);
    const retry = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button')).find(b => b.textContent.includes('Retry accounts'));
    retry!.click(); await vi.waitFor(() => expect(component.accountsLoading()).toBe(false));
    expect(service.read.mock.lastCall?.[0]).toEqual({ view: 'queued', accountUids: ['user-25'] });
    expect(component.page()).toBe(2); expect(component.accountsError()).toBe(''); expect(component.mode()).toBe('warnings-only');
  });
  it('keeps unavailable counts and missing logins distinct from a genuine zero', async () => {
    const { component, fixture, service } = await setup();
    const snapshot = response();
    snapshot.accounts[0].eventCount = null;
    snapshot.accounts[0].authPresent = false; snapshot.accounts[0].email = null;
    service.read.mockResolvedValue(snapshot);
    service.loadLoginOrder.mockResolvedValue({ entries: [{ uid: 'synthetic', lastLoginAt: null }], snapshot, dryRunId: undefined });
    fixture.detectChanges(); await vi.waitFor(() => expect((component.overviewLoading() || component.accountsLoading())).toBe(false)); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('td.mat-column-account').textContent).toContain('Auth account no longer present');
    expect(fixture.nativeElement.querySelector('td.mat-column-lastLogin').textContent.trim()).toBe('No recorded login');
    expect(fixture.nativeElement.querySelector('td.mat-column-events').textContent.trim()).toBe('Unavailable');
    expect(fixture.nativeElement.querySelector('td.mat-column-retention').textContent).toContain('Warning queued');
  });
  it('can return to a working page after a detail read fails', async () => {
    const { component, fixture, service, firstPage } = await render();
    service.read.mockRejectedValueOnce(new Error('page unavailable'));
    component.next(); await vi.waitFor(() => expect(component.accountsError()).toBeTruthy()); fixture.detectChanges();
    const previous: HTMLButtonElement = fixture.nativeElement.querySelector('.pagination button');
    expect(previous.disabled).toBe(false);
    previous.click(); await vi.waitFor(() => expect(component.rows()).toHaveLength(1));
    expect(component.page()).toBe(1); expect(component.accountsError()).toBe('');
    expect(service.read.mock.lastCall?.[0]).toEqual({ view: 'queued', accountUids: firstPage });
  });
  it('binds numeric controls, validates caps and resets edits', async () => {
    const { fixture, component, haptics } = await render();
    fixture.nativeElement.querySelector('.mode-toolbar button').click(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Initial warnings and final reminders share the warning limit');
    const input = fixture.nativeElement.querySelector('input');
    input.value = '101'; input.dispatchEvent(new Event('input')); fixture.detectChanges(); await fixture.whenStable();
    expect(component.warningLimit()).toBe(101); expect(component.canSave()).toBeFalsy();
    input.value = '10'; input.dispatchEvent(new Event('input')); fixture.detectChanges(); await fixture.whenStable();
    expect(component.canSave()).toBeTruthy(); expect(haptics.selection).toHaveBeenCalledTimes(1);
    component.reset(); expect(component.warningLimit()).toBe(100); expect(haptics.selection).toHaveBeenCalledTimes(2);
  });
  it('requires explicit confirmation for enforcement and reports a successful save', async () => {
    const { component, service, dialog, haptics } = await render();
    component.changeMode('enforce');
    const updated = response(); updated.settings = { ...updated.settings, mode: 'enforce', revision: 3 }; service.read.mockResolvedValue(updated);
    await component.save();
    expect(dialog.open.mock.calls[0][1].data).toMatchObject({ title: 'Enable account deletion?', confirmColor: 'warn' });
    expect(dialog.open.mock.calls[0][1].data.message).toContain('Change from Off to Enforce deletion.');
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
  it('orders the whole view before paging and reuses the login list until a view change', async () => {
    const { fixture, component, service, haptics, entries } = await setup();
    // The oldest and an unknown login come from the far end of the UID list.
    entries[25].lastLoginAt = entries[0].lastLoginAt;
    const unknown = { uid: 'unknown', lastLoginAt: null };
    service.loadLoginOrder.mockResolvedValue({ entries: [unknown, ...entries].reverse(), snapshot: response(), dryRunId: undefined });
    fixture.detectChanges(); await vi.waitFor(() => expect((component.overviewLoading() || component.accountsLoading())).toBe(false)); await fixture.whenStable(); fixture.detectChanges();
    expect(service.read.mock.lastCall?.[0].accountUids!.slice(0, 3)).toEqual(['synthetic', 'user-25', 'user-01']);
    const header = fixture.nativeElement.querySelector('th.mat-column-lastLogin');
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(fixture.nativeElement.querySelector('td.mat-column-events').textContent.trim()).toBe('0');
    expect(fixture.nativeElement.querySelector('td.mat-column-lastLogin').textContent).toContain('2024');
    header.querySelector('[role="button"]').click(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('th.mat-column-lastLogin').getAttribute('aria-sort')).toBe('descending');
    expect(service.read.mock.lastCall?.[0].accountUids![0]).toBe('user-24');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    component.next(); await fixture.whenStable();
    expect(service.read).toHaveBeenLastCalledWith({ view: 'queued', accountUids: ['user-25', 'unknown'] });
    component.previous(); await vi.waitFor(() => expect((component.overviewLoading() || component.accountsLoading())).toBe(false)); await fixture.whenStable();
    expect(service.loadLoginOrder).toHaveBeenCalledTimes(1);
    component.changeView('pending-deletion'); await fixture.whenStable();
    expect(service.loadLoginOrder).toHaveBeenCalledTimes(2); expect(component.page()).toBe(1);
  });
  it('shows the full scan total and pins selected accounts to the published report', async () => {
    const { fixture, component, service, haptics, entries, firstPage } = await setup();
    const first = response();
    first.lastCompletedDryRun = { id: 'first', eligibleCount: 31, finishedAt: Date.UTC(2026, 10, 18) };
    service.read.mockResolvedValue(first);
    service.loadLoginOrder.mockImplementation(async view => ({ entries, snapshot: first, dryRunId: view === 'eligible' ? 'first' : undefined }));
    fixture.detectChanges(); await vi.waitFor(() => expect((component.overviewLoading() || component.accountsLoading())).toBe(false)); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Last completed dry run"]').textContent).toContain('31');
    const review = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button')).find(b => b.textContent.includes('Review eligible accounts'));
    review!.click(); await vi.waitFor(() => expect((component.overviewLoading() || component.accountsLoading())).toBe(false)); await fixture.whenStable(); fixture.detectChanges();
    expect(service.read).toHaveBeenLastCalledWith({ view: 'eligible', accountUids: firstPage, dryRunId: 'first' });
    expect(fixture.nativeElement.querySelectorAll('th')).toHaveLength(3);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    component.next(); await fixture.whenStable();
    expect(service.read).toHaveBeenLastCalledWith({ view: 'eligible', accountUids: ['user-25'], dryRunId: 'first' });
    const replacement = { ...first, lastCompletedDryRun: { ...first.lastCompletedDryRun, id: 'replacement' } };
    service.read.mockResolvedValue(replacement);
    service.loadLoginOrder.mockResolvedValue({ entries, snapshot: replacement, dryRunId: 'replacement' });
    component.previous(); await vi.waitFor(() => expect((component.overviewLoading() || component.accountsLoading())).toBe(false)); await fixture.whenStable();
    expect(component.page()).toBe(1);
    expect(service.read).toHaveBeenLastCalledWith({ view: 'eligible', accountUids: firstPage, dryRunId: 'replacement' });
    expect(component.accountNotice()).toContain('Showing its first page');
    component.next(); await fixture.whenStable();
    expect(service.read).toHaveBeenLastCalledWith({ view: 'eligible', accountUids: ['user-25'], dryRunId: 'replacement' });
    expect(component.accountNotice()).toBe('');
    expect(service.save).not.toHaveBeenCalled();
  });
  it('distinguishes an older scan without a report from a completed empty report', async () => {
    const { fixture, component, service } = await render();
    const waitingForReport = 'The eligible account list will appear';
    expect(fixture.nativeElement.textContent).not.toContain(waitingForReport);
    service.loadLoginOrder.mockResolvedValue({ entries: [], dryRunId: undefined, snapshot: response() });
    component.changeView('eligible'); await vi.waitFor(() => expect(component.accountsLoading()).toBe(false)); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(waitingForReport);
    expect(fixture.nativeElement.textContent).not.toContain('No accounts in this view');
    service.loadLoginOrder.mockResolvedValue({ entries: [], dryRunId: 'empty', snapshot: { ...response(), accounts: [], nextUid: null,
      lastCompletedDryRun: { id: 'empty', eligibleCount: 0, finishedAt: Date.UTC(2026, 10, 18) } } });
    component.refresh(); await vi.waitFor(() => expect(component.data()?.lastCompletedDryRun?.id).toBe('empty')); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No accounts qualified for a first warning');
    expect(fixture.nativeElement.textContent).not.toContain(waitingForReport);
  });
  it('shows read failures without implying an empty queue and permits refresh', async () => {
    const { fixture, component, service, haptics } = await setup();
    service.read.mockRejectedValueOnce(new Error('synthetic')); fixture.detectChanges(); await vi.waitFor(() => expect((component.overviewLoading() || component.accountsLoading())).toBe(false)); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Unable to load');
    expect(fixture.nativeElement.textContent).not.toContain('No accounts in this view'); expect(haptics.error).not.toHaveBeenCalled();
    component.refresh(); await fixture.whenStable(); expect(component.data()).not.toBeNull();
  });
  it('allows a fresh overview read if the settings save succeeds but reading the new mode fails', async () => {
    const { component, service } = await render();
    component.toggleEditing(); component.changeMode('dry-run');
    service.read.mockRejectedValueOnce(new Error('readback failed'));
    await component.save();
    expect(component.notice()).toContain('Settings saved');
    expect(component.data()).toBeNull(); expect(component.dirty()).toBe(false);
    expect(component.error()).toContain('Refresh');
    const updated = response(); updated.settings.mode = 'dry-run'; updated.settings.revision++;
    service.read.mockResolvedValue(updated);
    service.loadLoginOrder.mockResolvedValue({ entries: [], snapshot: updated, dryRunId: undefined });
    component.refresh(); await vi.waitFor(() => expect(component.view()).toBe('eligible'));
    expect(component.currentModeLabel()).toBe('Dry run'); expect(component.error()).toBe('');
  });
  it('clears stale settings on a failed refresh and restores the editor from the next successful read', async () => {
    const { component, fixture, service } = await render();
    component.toggleEditing();
    service.read.mockRejectedValueOnce(new Error('overview unavailable'));
    component.refresh(); await vi.waitFor(() => expect(component.error()).toContain('Refresh')); fixture.detectChanges();
    expect(component.baseline()).toBeNull(); expect(component.editing()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Current mode');
    expect(fixture.nativeElement.textContent).not.toContain('Retry accounts');
    const updated = response(); updated.settings.mode = 'dry-run'; updated.settings.revision++;
    service.read.mockResolvedValue(updated);
    service.loadLoginOrder.mockResolvedValue({ entries: [], snapshot: updated, dryRunId: undefined });
    fixture.nativeElement.querySelector('.mode-toolbar button').click();
    await vi.waitFor(() => expect(component.view()).toBe('eligible')); fixture.detectChanges();
    expect(component.currentModeLabel()).toBe('Dry run'); expect(component.error()).toBe('');
    fixture.nativeElement.querySelector('.mode-toolbar button').click(); component.changeMode('warnings-only');
    expect(component.canSave()).toBe(true);
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
  it('does not revive an old confirmation after leaving and returning to the same administrator', async () => {
    const { component, ownerChanged, service, dialog } = await render();
    const closed = new Subject<boolean>(); dialog.open.mockReturnValue({ afterClosed: () => closed, close: vi.fn() });
    component.changeMode('enforce'); const saving = component.save();
    ownerChanged(null); ownerChanged('admin');
    // A dialog that was already closing can deliver its earlier result after the account switch.
    closed.next(true); closed.complete(); await saving;
    expect(service.save).not.toHaveBeenCalled();
  });
  it.each(['success', 'failure'])('keeps an old save %s from clearing a new session confirmation or saving state', async outcome => {
    const { component, ownerChanged, service, dialog, haptics } = await render();
    let finishSave!: () => void;
    service.save.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finishSave = () => outcome === 'success' ? resolve() : reject(new Error('old-session'));
    }));
    component.changeMode('enforce'); const first = component.save(); await Promise.resolve();
    expect(service.save).toHaveBeenCalledTimes(1);
    ownerChanged(null); ownerChanged('admin'); component.refresh(); await Promise.resolve(); await Promise.resolve();
    const closed = new Subject<boolean>(); const close = vi.fn();
    dialog.open.mockReturnValue({ afterClosed: () => closed, close });
    component.changeMode('warnings-only'); const second = component.save();
    finishSave(); await first;
    expect(component.saving()).toBe(true); expect(component.error()).toBe('');
    expect(haptics.error).not.toHaveBeenCalled(); expect(haptics.success).not.toHaveBeenCalled();
    ownerChanged(null); expect(close).toHaveBeenCalledTimes(1);
    closed.next(false); closed.complete(); await second;
    expect(service.save).toHaveBeenCalledTimes(1);
  });
  it('discards pending reads on destruction and releases the account subscription', async () => {
    const { fixture, component, service, unwatch } = await setup();
    let finish!: (value: InactivityAdminResponse) => void; service.read.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fixture.detectChanges(); fixture.destroy(); finish(response()); await Promise.resolve(); await Promise.resolve();
    expect(component.data()).toBeNull(); expect(unwatch).toHaveBeenCalledTimes(1);
  });
});
