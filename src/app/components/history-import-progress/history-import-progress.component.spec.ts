import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatIconRegistry } from '@angular/material/icon';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { FirebaseUserType } from 'app/firebase/auth';
import { HistoryImportProgressService, type HistoryImportOwner } from '../../services/history-import-progress.service';
import { buildHistoryImportProgress, type HistoryImportSource, type HistoryImportProgressItem,
  type HistoryImportResultDismissal } from '../../helpers/history-import-progress.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppEventService } from '../../services/app.event.service';
import { HistoryImportCardsComponent } from './history-import-cards.component';
import { HistoryImportIndicatorComponent } from './history-import-indicator.component';
import { HistoryImportPanelComponent } from './history-import-panel.component';

@Component({standalone: true, imports: [HistoryImportIndicatorComponent, HistoryImportCardsComponent],
  template: '<app-history-import-indicator /><app-history-import-cards ownerUid="owner" placement="dashboard" />'})
class SharedSurfaces {}
@Component({standalone: true, template: ''}) class Destination {}
function projection(status = 'requesting', active = true, count = 7) {
  return {runId: 'run', rangePreset: '30_days', updatedAtMs: Date.now(), active,
    steps: [{id: 'activities', resources: ['activities'], status, count}]};
}
async function setup(mobile = false) {
  const owner = signal<HistoryImportOwner | null>({uid: 'owner', session: {uid: 'owner'} as FirebaseUserType});
  const sources = signal<HistoryImportSource[]>([{serviceName: ServiceNames.SuuntoApp, projection: projection()}]);
  const dismissedResults = signal<HistoryImportResultDismissal[]>([]);
  const view = computed(() => buildHistoryImportProgress(owner() ? sources() : [], Date.now(), dismissedResults()));
  const refreshing = signal(false);
  const dashboardHidden = signal(false);
  const setDashboardHidden = vi.fn((hidden: boolean, expectedOwner: HistoryImportOwner | null) => {
    if (!owner() || owner() !== expectedOwner || dashboardHidden() === hidden) return false;
    dashboardHidden.set(hidden); return true;
  });
  const dismissResult = vi.fn((item: HistoryImportProgressItem, expectedOwner: HistoryImportOwner | null) => {
    if (!owner() || owner() !== expectedOwner || !item.canDismiss || !item.runId || item.updatedAtMs === undefined
      || !view().items.includes(item)) return false;
    dismissedResults.update(previous => [...previous, {serviceName: item.serviceName, runId: item.runId!, updatedAtMs: item.updatedAtMs!}]);
    return true;
  });
  const progress = {owner, view, refreshing, refresh: vi.fn(), dashboardHidden, setDashboardHidden, dismissResult};
  const closed$ = new Subject<void>();
  const dismiss = vi.fn();
  const dialog = {open: vi.fn().mockReturnValue({close: dismiss, afterClosed: () => closed$})};
  const sheet = {open: vi.fn().mockReturnValue({dismiss, afterDismissed: () => closed$})};
  const haptics = {selection: vi.fn()};
  TestBed.configureTestingModule({imports: [SharedSurfaces, HistoryImportPanelComponent], providers: [
    provideRouter([{path: 'services', component: Destination}]), provideNoopAnimations(),
    {provide: HistoryImportProgressService, useValue: progress}, {provide: AppHapticsService, useValue: haptics},
    {provide: AppEventService, useValue: {}}, {provide: BreakpointObserver, useValue: {isMatched: () => mobile, observe: () => of({matches: false, breakpoints: {}})}},
    {provide: MatDialog, useValue: dialog}, {provide: MatBottomSheet, useValue: sheet},
    {provide: MAT_DIALOG_DATA, useValue: {owner: owner()}}, {provide: MatDialogRef, useValue: {close: dismiss}},
  ]});
  TestBed.overrideComponent(HistoryImportIndicatorComponent, {add: {providers: [
    {provide: MatDialog, useValue: dialog}, {provide: MatBottomSheet, useValue: sheet},
  ]}});
  await TestBed.compileComponents();
  vi.spyOn(TestBed.inject(MatIconRegistry), 'getNamedSvgIcon').mockImplementation(() => of(document.createElementNS('http://www.w3.org/2000/svg', 'svg')));
  return {owner, sources, progress, dialog, sheet, haptics, closed$, dismiss};
}
describe('shared history import surfaces', () => {
  it('uses a compact icon control while retaining the full status and provider count for accessibility', async () => {
    const state = await setup();
    const fixture = TestBed.createComponent(HistoryImportIndicatorComponent); fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.hasAttribute('mat-icon-button')).toBe(true);
    expect(button.hasAttribute('mat-button')).toBe(false);
    expect(button.getAttribute('aria-label')).toContain('Importing history. View history import status for 1 provider');
    expect(button.querySelector('.cdk-visually-hidden')?.textContent).toContain('Importing history · 1');
    expect(button.querySelector('mat-progress-spinner')).not.toBeNull();
    expect(state.haptics.selection).not.toHaveBeenCalled();
  });

  it('uses flat provider rows inside the panel and retains outlined cards on the dashboard', async () => {
    await setup();
    const fixture = TestBed.createComponent(SharedSurfaces); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-history-import-cards mat-card')?.classList.contains('qs-overlay-flat')).toBe(false);
    const panel = TestBed.createComponent(HistoryImportPanelComponent); panel.detectChanges();
    expect(panel.nativeElement.querySelector('mat-card')?.classList.contains('qs-overlay-flat')).toBe(true);
    expect(panel.nativeElement.querySelector('button[role="switch"]')?.getAttribute('aria-labelledby')).toBe('history-import-dashboard-label');
    expect(panel.nativeElement.querySelector('#history-import-dashboard-label')?.textContent).toBe('Show on dashboard');
  });

  it('updates the header and dashboard card from the same live state and clears both on sign-out', async () => {
    const state = await setup(); const fixture = TestBed.createComponent(SharedSurfaces); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('button.history-import-header-action')?.textContent).toContain('Importing history · 1');
    expect(host.querySelector('button.history-import-header-action')?.getAttribute('aria-label')).toContain('1 provider');
    expect(host.querySelector('app-history-import-cards')?.textContent).toContain('7 items or requests');
    state.sources.set([{serviceName: ServiceNames.SuuntoApp, projection: projection('requesting', true, 24)},
      {serviceName: ServiceNames.WahooAPI, projection: projection('failed', false)}]); fixture.detectChanges();
    expect(host.querySelector('button.history-import-header-action')?.textContent).toContain('Importing history · 2');
    expect(host.querySelectorAll('mat-card')).toHaveLength(2);
    expect(host.querySelector('app-history-import-cards')?.textContent).toContain('24 items or requests');
    expect(state.haptics.selection).not.toHaveBeenCalled();
    state.owner.set(null); fixture.detectChanges();
    expect(host.querySelector('button.history-import-header-action')).toBeNull();
    expect(host.querySelector('mat-card')).toBeNull();
  });
  it('shows requested status without an active spinner and preserves exact provider links', async () => {
    const state = await setup(); state.sources.set([{serviceName: ServiceNames.GarminAPI, projection: projection('requested', false)}]);
    const fixture = TestBed.createComponent(SharedSurfaces); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('button.history-import-header-action')?.textContent).toContain('History requested');
    expect(host.querySelector('mat-progress-spinner')).toBeNull();
    expect(host.querySelector('mat-progress-bar')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toContain('serviceName=Garmin%20API');
    expect(host.textContent).toContain('7 requests scheduled');
    expect(host.textContent).not.toContain('items or requests');
    expect(host.textContent).toContain('Counts describe scheduled requests, not records received');
    expect(host.textContent).toContain('Garmin sends records separately after accepting requests');
    expect(host.textContent).toContain('Delivery may take hours or days; delivery completion is not tracked here');
  });
  it.each(['queued', 'requesting', 'retrying'])('labels Garmin %s progress as requests across shared surfaces', async status => {
    const state = await setup(); state.sources.set([{serviceName: ServiceNames.GarminAPI, projection: projection(status, true, 1)}]);
    const fixture = TestBed.createComponent(SharedSurfaces); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const header = host.querySelector('.history-import-header-action')!;
    const label = status === 'retrying' ? 'Waiting to retry Garmin requests' : 'Requesting Garmin history';
    expect(header.textContent).toContain(label);
    expect(header.getAttribute('aria-label')).toContain(label);
    expect(host.querySelector('.provider-status')?.textContent).toContain(status === 'retrying' ? 'Waiting to retry requests' : 'Requesting history');
    expect(host.textContent).toContain('1 request scheduled');
    expect(host.textContent).toContain('delivery completion is not tracked here');
    const bar = host.querySelector('mat-progress-bar');
    if (status === 'retrying') expect(bar).toBeNull();
    else expect(bar?.getAttribute('aria-label')).toBe('Garmin history request submission in progress');
    expect(state.progress.refresh).not.toHaveBeenCalled();
    expect(state.haptics.selection).not.toHaveBeenCalled();
  });
  it('keeps Garmin request issues dismissible without treating request counts as failed records', async () => {
    const state = await setup(); state.sources.set([{serviceName: ServiceNames.GarminAPI, projection: projection('failed', false, 3)}]);
    const fixture = TestBed.createComponent(SharedSurfaces); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.coverage-note')?.textContent).toContain('Request processing has finished with issues');
    expect(host.querySelector('.coverage-note')?.textContent).toContain('not failure totals');
    expect(host.textContent).toContain('3 requests scheduled');
    expect(host.querySelector('mat-progress-spinner')).toBeNull();
    expect(host.querySelector('mat-progress-bar')).toBeNull();
    (host.querySelector('button[aria-label="Dismiss Garmin history import result"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelector('mat-card')).toBeNull();
    expect(host.querySelector('.history-import-header-action')).toBeNull();
  });
  it.each(['failed', 'skipped'])('lets the owner dismiss a finished %s result from both surfaces while future imports remain visible', async status => {
    const state = await setup();
    state.sources.set([{serviceName: ServiceNames.SuuntoApp, projection: projection(status, false, 26)}]);
    const fixture = TestBed.createComponent(SharedSurfaces); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.history-import-header-action')?.textContent).toContain('History finished with issues');
    expect(host.querySelector('.provider-status')?.textContent).toContain('Finished with issues');
    expect(host.querySelector('.coverage-note')?.textContent).toContain('not failure totals');
    expect(host.querySelector('mat-progress-spinner')).toBeNull();
    expect(host.querySelector('mat-progress-bar')).toBeNull();
    expect(state.haptics.selection).not.toHaveBeenCalled();
    const button = host.querySelector('button[aria-label="Dismiss Suunto history import result"]') as HTMLButtonElement;
    button.click(); fixture.detectChanges(); button.click();
    expect(host.querySelector('.history-import-header-action')).toBeNull();
    expect(host.querySelector('mat-card')).toBeNull();
    expect(state.progress.dashboardHidden()).toBe(false);
    expect(state.haptics.selection).toHaveBeenCalledTimes(1);
    state.sources.set([{serviceName: ServiceNames.SuuntoApp, projection: {...projection(), runId: 'next-run'}}]); fixture.detectChanges();
    expect(host.querySelector('.history-import-header-action')?.textContent).toContain('Importing history');
    expect(host.querySelector('mat-card')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Dismiss Suunto history import result"]')).toBeNull();
  });
  it('never offers dismissal for live work, reconnect guidance or unknown status', async () => {
    const state = await setup(); const fixture = TestBed.createComponent(SharedSurfaces);
    for (const source of [
      {serviceName: ServiceNames.SuuntoApp, projection: projection()},
      {serviceName: ServiceNames.SuuntoApp, projection: projection('retrying')},
      {serviceName: ServiceNames.SuuntoApp, projection: projection(), connectionState: 'reconnect_required' as const},
      {serviceName: ServiceNames.SuuntoApp, unavailable: true},
    ]) {
      state.sources.set([source]); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('button[aria-label="Dismiss Suunto history import result"]')).toBeNull();
    }
    expect(state.progress.dismissResult).not.toHaveBeenCalled();
    expect(state.haptics.selection).not.toHaveBeenCalled();
  });
  it('does not expose current-owner cards on another account dashboard', async () => {
    await setup(); const fixture = TestBed.createComponent(HistoryImportCardsComponent);
    fixture.componentRef.setInput('ownerUid', 'someone-else'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-card')).toBeNull();
  });
  it('updates both surfaces when authorization is lost and hides retained runs on disconnect', async () => {
    const state = await setup(); const fixture = TestBed.createComponent(SharedSurfaces); fixture.detectChanges();
    const retained = projection('retrying');
    state.sources.set([{serviceName: ServiceNames.SuuntoApp, projection: retained, connectionState: 'reconnect_required'}]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('button.history-import-header-action')?.textContent).toContain('History needs attention');
    expect(host.querySelector('mat-progress-spinner')).toBeNull();
    expect(host.querySelector('mat-progress-bar')).toBeNull();
    expect(host.querySelector('app-history-import-cards')?.textContent).toContain('Open Connections');
    expect(host.querySelector('app-history-import-cards')?.textContent).not.toContain('Waiting to retry');
    expect(host.querySelector('a')?.getAttribute('href')).toContain('serviceName=Suunto%20app');
    state.sources.set([{serviceName: ServiceNames.SuuntoApp, projection: retained, connectionState: 'disconnect_pending'}]);
    fixture.detectChanges();
    expect(host.querySelector('button.history-import-header-action')).toBeNull();
    expect(host.querySelector('mat-card')).toBeNull();
    expect(state.haptics.selection).not.toHaveBeenCalled();
  });
  it('displays unavailable reads accessibly and refreshes status without a provider operation', async () => {
    const state = await setup(); state.sources.set([{serviceName: ServiceNames.COROSAPI, unavailable: true}]);
    const fixture = TestBed.createComponent(SharedSurfaces); fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('app-history-import-cards button[aria-busy]') as HTMLButtonElement;
    expect(button.textContent).toContain('Refresh status'); button.click();
    expect(state.progress.refresh).toHaveBeenCalledTimes(1);
    expect(state.haptics.selection).toHaveBeenCalledTimes(1);
  });
  it('keeps an unavailable card visible with a disabled loading action during refresh', async () => {
    const state = await setup(); state.sources.set([{serviceName: ServiceNames.COROSAPI, unavailable: true}]);
    state.progress.refresh.mockImplementation(() => state.progress.refreshing.set(true));
    const fixture = TestBed.createComponent(SharedSurfaces); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector('app-history-import-cards button[aria-busy]') as HTMLButtonElement;
    button.click(); fixture.detectChanges(); button.click();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Checking status');
    expect(host.querySelector('app-history-import-cards mat-progress-spinner')).not.toBeNull();
    expect(host.querySelector('mat-card')).not.toBeNull();
    expect(state.progress.refresh).toHaveBeenCalledTimes(1);
    expect(state.haptics.selection).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('opens the shared cards once with one haptic (mobile=%s)', async mobile => {
    const state = await setup(mobile); const fixture = TestBed.createComponent(HistoryImportIndicatorComponent); fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(state.haptics.selection).not.toHaveBeenCalled(); button.click(); button.click(); fixture.detectChanges();
    const opener = mobile ? state.sheet.open : state.dialog.open;
    expect(opener).toHaveBeenCalledTimes(1);
    expect(opener.mock.calls[0][0]).toBe(HistoryImportPanelComponent);
    expect(opener.mock.calls[0][1].data.owner).toBe(state.owner());
    if (mobile) expect(opener.mock.calls[0][1].panelClass).toBe('qs-bottom-sheet-container');
    expect(state.haptics.selection).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    state.closed$.next(); fixture.detectChanges(); expect(button.getAttribute('aria-expanded')).toBe('false');
  });
  it('dismisses its owned panel on indicator teardown', async () => {
    const state = await setup(); const fixture = TestBed.createComponent(HistoryImportIndicatorComponent); fixture.detectChanges();
    fixture.componentInstance.open(); fixture.destroy();
    expect(state.dismiss).toHaveBeenCalledTimes(1);
    expect(state.closed$.observed).toBe(false);
  });
  it('clears and silently closes an open panel when its owner changes', async () => {
    const state = await setup(); const fixture = TestBed.createComponent(HistoryImportPanelComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-history-import-cards')).not.toBeNull();
    state.owner.set({uid: 'other', session: {uid: 'other'} as FirebaseUserType}); fixture.detectChanges();
    expect(state.dismiss).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('mat-card')).toBeNull();
    expect(state.haptics.selection).not.toHaveBeenCalled();
  });
  it('hides only dashboard cards and restores them from the header panel with one haptic per action', async () => {
    const state = await setup(); const dashboard = TestBed.createComponent(SharedSurfaces); dashboard.detectChanges();
    const host = dashboard.nativeElement as HTMLElement;
    const hide = host.querySelector('button[aria-label="Hide history import progress from dashboard"]') as HTMLButtonElement;
    expect(hide).not.toBeNull(); hide.click(); dashboard.detectChanges();
    expect(host.querySelector('mat-card')).toBeNull();
    expect(host.querySelector('.history-import-header-action')?.textContent).toContain('Importing history');
    expect(state.haptics.selection).toHaveBeenCalledTimes(1);
    state.sources.set([{serviceName: ServiceNames.SuuntoApp, projection: projection('requesting', true, 24)}]);
    dashboard.detectChanges(); expect(host.querySelector('mat-card')).toBeNull();
    const panel = TestBed.createComponent(HistoryImportPanelComponent); panel.detectChanges();
    expect(panel.nativeElement.querySelector('mat-card')).not.toBeNull();
    expect(panel.nativeElement.querySelector('button[aria-label="Hide history import progress from dashboard"]')).toBeNull();
    const toggle = panel.nativeElement.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('false'); toggle.click();
    panel.detectChanges(); dashboard.detectChanges();
    expect(host.querySelector('mat-card')?.textContent).toContain('24 items or requests');
    expect(state.haptics.selection).toHaveBeenCalledTimes(2);
    panel.componentInstance.setShowOnDashboard(true);
    expect(state.haptics.selection).toHaveBeenCalledTimes(2);
  });
});
