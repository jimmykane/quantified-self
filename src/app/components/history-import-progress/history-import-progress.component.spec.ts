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
import { buildHistoryImportProgress, type HistoryImportSource } from '../../helpers/history-import-progress.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppEventService } from '../../services/app.event.service';
import { HistoryImportCardsComponent } from './history-import-cards.component';
import { HistoryImportIndicatorComponent } from './history-import-indicator.component';
import { HistoryImportPanelComponent } from './history-import-panel.component';

@Component({standalone: true, imports: [HistoryImportIndicatorComponent, HistoryImportCardsComponent],
  template: '<app-history-import-indicator /><app-history-import-cards ownerUid="owner" />'})
class SharedSurfaces {}
@Component({standalone: true, template: ''}) class Destination {}
function projection(status = 'requesting', active = true, count = 7) {
  return {runId: 'run', rangePreset: '30_days', updatedAtMs: Date.now(), active,
    steps: [{id: 'activities', resources: ['activities'], status, count}]};
}
async function setup(mobile = false) {
  const owner = signal<HistoryImportOwner | null>({uid: 'owner', session: {uid: 'owner'} as FirebaseUserType});
  const sources = signal<HistoryImportSource[]>([{serviceName: ServiceNames.SuuntoApp, projection: projection()}]);
  const view = computed(() => buildHistoryImportProgress(owner() ? sources() : [], Date.now()));
  const progress = {owner, view, refresh: vi.fn()};
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
    expect(host.textContent).toContain('Provider delivery may take hours or days');
  });
  it('does not expose current-owner cards on another account dashboard', async () => {
    await setup(); const fixture = TestBed.createComponent(HistoryImportCardsComponent);
    fixture.componentRef.setInput('ownerUid', 'someone-else'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-card')).toBeNull();
  });
  it('displays unavailable reads accessibly and refreshes status without a provider operation', async () => {
    const state = await setup(); state.sources.set([{serviceName: ServiceNames.COROSAPI, unavailable: true}]);
    const fixture = TestBed.createComponent(SharedSurfaces); fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('app-history-import-cards button') as HTMLButtonElement;
    expect(button.textContent).toContain('Refresh status'); button.click();
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
});
