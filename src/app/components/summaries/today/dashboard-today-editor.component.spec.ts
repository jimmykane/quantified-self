import { TestBed } from '@angular/core/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardTodayEditorComponent } from './dashboard-today-editor.component';
import {
  DashboardConfigurationConflict,
  DashboardConfigurationService,
} from '../../../services/dashboard-configuration.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { AppUserInterface } from '../../../models/app-user.interface';
import { defaultDashboardTodaySettings } from '../../../helpers/dashboard-today-settings.helper';
import { DashboardTodayAvailabilityService } from '../../../services/dashboard-today-availability.service';
import { buildDashboardTodayAvailability } from '../../../helpers/dashboard-today-availability.helper';

describe('Customize Today', () => {
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const persistence = { save: vi.fn() };
  const announcer = { announce: vi.fn().mockResolvedValue(undefined) };
  const ref = { close: vi.fn(), disableClose: false };
  const users = { user: signal<AppUserInterface | null>(null) };
  const emptyAvailability = () => buildDashboardTodayAvailability({ metrics: {}, derived: null, sleep: null, sleepStatus: 'loading', nowMs: Date.now() });
  const evidence = { connect: vi.fn(), availability: signal(emptyAvailability()) };
  let user: AppUserInterface;
  beforeEach(() => {
    vi.clearAllMocks();
    persistence.save.mockResolvedValue(undefined);
    user = {
      uid: 'owner',
      settings: { dashboardSettings: { tiles: [], showTodaySummary: true } },
    } as AppUserInterface;
    users.user.set(user);
    evidence.availability.set(emptyAvailability());
    TestBed.configureTestingModule({
      imports: [DashboardTodayEditorComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: user },
        { provide: MatDialogRef, useValue: ref },
        { provide: DashboardConfigurationService, useValue: persistence },
        { provide: AppUserService, useValue: users },
        { provide: AppHapticsService, useValue: haptics },
        { provide: LiveAnnouncer, useValue: announcer },
      ],
    });
    TestBed.overrideComponent(DashboardTodayEditorComponent, { set: { providers: [
      { provide: DashboardTodayAvailabilityService, useValue: evidence },
    ] } });
  });
  const render = () => {
    const fixture = TestBed.createComponent(DashboardTodayEditorComponent);
    fixture.detectChanges();
    return fixture;
  };
  it('shows live availability for selected and unselected metrics without disabling choices or restarting checks', () => {
    const fixture = render(), editor = fixture.componentInstance;
    const host = fixture.nativeElement as HTMLElement;
    expect(evidence.connect).toHaveBeenCalledExactlyOnceWith(user);
    expect(host.querySelector('#today-data-weight')?.textContent).toContain('Checking data');
    evidence.availability.update(current => ({ ...current,
      load: { state: 'ready', hasData: true, label: 'Data available', reason: '' },
      weight: { state: 'no-data', hasData: false, label: 'No weigh-in recorded', reason: '' },
      steps: { state: 'error', hasData: false, label: 'Unable to load data', reason: '' },
      hrv: { state: 'history', hasData: true, label: 'More HRV history required', reason: '' },
    }));
    fixture.detectChanges();
    expect(host.querySelector('#today-data-load')?.getAttribute('data-state')).toBe('ready');
    expect(host.querySelector('#today-data-hrv')?.textContent).toContain('More HRV history required');
    expect(host.querySelector('#today-data-steps')?.getAttribute('data-state')).toBe('error');
    const weight = host.querySelector<HTMLInputElement>('#today-metric-weight input')!;
    expect(weight.getAttribute('aria-describedby')).toContain('today-data-weight');
    expect(weight.disabled).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
    editor.toggleMetric('weight', true); fixture.detectChanges();
    expect(host.querySelectorAll('#today-data-weight')).toHaveLength(1);
    expect(host.querySelector('#today-data-weight')?.textContent).toContain('No weigh-in recorded');
    expect(editor.draft().metrics).toContain('weight');
    expect(evidence.connect).toHaveBeenCalledTimes(1);
    expect(persistence.save).not.toHaveBeenCalled();
  });
  it('opens silently, keeps edits in a draft and allows keyboard ordering without changing saved settings', () => {
    const fixture = render(),
      editor = fixture.componentInstance;
    expect(editor.selected().map((value) => value.id)).toEqual([
      'load',
      'sleep',
      'hrv',
      'overnight-hr',
    ]);
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(announcer.announce).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        'button[mat-flat-button]'
      )?.disabled
    ).toBe(true);
    editor.toggleMetric('weight', true);
    fixture.detectChanges();
    const button = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('button[aria-label="Move Weight up"]')!;
    button.click();
    fixture.detectChanges();
    expect(editor.draft().metrics).toEqual([
      'load',
      'sleep',
      'hrv',
      'weight',
      'overnight-hr',
    ]);
    expect(user.settings.dashboardSettings.today).toBeUndefined();
    editor.cancel();
    expect(ref.close).toHaveBeenCalledExactlyOnceWith(false);
    expect(persistence.save).not.toHaveBeenCalled();
  });
  it('restores the three-block default and saves only the Today field once', async () => {
    const fixture = render(),
      editor = fixture.componentInstance;
    editor.reset();
    fixture.detectChanges();
    expect(editor.draft()).toEqual(defaultDashboardTodaySettings());
    await editor.save();
    expect(persistence.save).toHaveBeenCalledExactlyOnceWith(
      'owner',
      { tiles: [], showTodaySummary: true },
      { today: defaultDashboardTodaySettings() }
    );
    expect(user.settings.dashboardSettings.today).toEqual(
      defaultDashboardTodaySettings()
    );
    expect(haptics.success).toHaveBeenCalledTimes(1);
    expect(ref.close).toHaveBeenCalledWith(true);
  });
  it('blocks duplicate saves and edits while pending, then keeps a failed draft reviewable', async () => {
    let reject!: (error: Error) => void;
    persistence.save.mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        })
    );
    const fixture = render(),
      editor = fixture.componentInstance;
    editor.reset();
    const pending = editor.save();
    fixture.detectChanges();
    expect(ref.disableClose).toBe(true);
    const count = haptics.selection.mock.calls.length;
    editor.toggleMetric('weight', true);
    editor.move(0, 1);
    editor.cancel();
    await editor.save();
    expect(haptics.selection).toHaveBeenCalledTimes(count);
    expect(persistence.save).toHaveBeenCalledTimes(1);
    reject(new DashboardConfigurationConflict());
    await pending;
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
        ?.textContent
    ).toContain('Your dashboard settings have changed.');
    expect(user.settings.dashboardSettings.today).toBeUndefined();
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(ref.close).not.toHaveBeenCalled();
  });
  it('enables Save only for a changed draft and explains what restoring defaults will show', () => {
    const fixture = render(),
      editor = fixture.componentInstance;
    const save = () =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        'button[mat-flat-button]'
      )!;
    expect(save().disabled).toBe(true);
    editor.toggleBlock('readiness', false);
    fixture.detectChanges();
    expect(save().disabled).toBe(false);
    editor.toggleBlock('readiness', true);
    fixture.detectChanges();
    expect(save().disabled).toBe(true);
    editor.reset();
    fixture.detectChanges();
    expect(editor.isDefault()).toBe(true);
    expect(save().disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain(
      'Defaults: Training state, Readiness and Load.'
    );
    const count = haptics.selection.mock.calls.length;
    editor.reset();
    expect(haptics.selection).toHaveBeenCalledTimes(count);
  });
  it('retains focus when a metric moves between lists and announces accepted reorder actions', async () => {
    const fixture = render(),
      editor = fixture.componentInstance;
    editor.toggleMetric('weight', true);
    fixture.detectChanges();
    await fixture.whenStable();
    const input = () =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '#today-metric-weight input'
      )!;
    expect(document.activeElement).toBe(input());
    editor.move(4, -4);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(input());
    expect(announcer.announce).toHaveBeenLastCalledWith(
      'Weight moved to position 1 of 5.'
    );
    editor.toggleMetric('weight', false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(input());
    expect(input().checked).toBe(false);
    expect(announcer.announce).toHaveBeenLastCalledWith(
      'Weight removed from Today.'
    );
  });
  it('keeps failed saves visible outside the scrolling list without exposing technical errors', async () => {
    persistence.save.mockRejectedValue(
      new Error('FirebaseError: permission-denied in users/config')
    );
    const fixture = render(),
      editor = fixture.componentInstance;
    editor.reset();
    await editor.save();
    fixture.detectChanges();
    const error = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="alert"]'
    );
    expect(error?.textContent).toContain('Your selections have been retained.');
    expect(error?.closest('.today-editor-content')).toBeNull();
    expect(error?.textContent).not.toContain('Firebase');
    expect(editor.hasChanges()).toBe(true);
    expect(haptics.error).toHaveBeenCalledOnce();
  });
  it('closes on an account switch and rejects stale saves without feedback', async () => {
    const fixture = render(),
      editor = fixture.componentInstance;
    users.user.set(null);
    fixture.detectChanges();
    await editor.save();
    expect(ref.close).toHaveBeenCalledWith(false);
    expect(persistence.save).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });
});
