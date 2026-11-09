import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardTodayEditorComponent } from './dashboard-today-editor.component';
import { DashboardConfigurationService } from '../../../services/dashboard-configuration.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { AppUserInterface } from '../../../models/app-user.interface';
import { defaultDashboardTodaySettings } from '../../../helpers/dashboard-today-settings.helper';

describe('Customize Today', () => {
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const persistence = { save: vi.fn() };
  const ref = { close: vi.fn(), disableClose: false };
  const users = { user: signal<AppUserInterface | null>(null) };
  let user: AppUserInterface;
  beforeEach(() => {
    vi.clearAllMocks();
    persistence.save.mockResolvedValue(undefined);
    user = {
      uid: 'owner',
      settings: { dashboardSettings: { tiles: [], showTodaySummary: true } },
    } as AppUserInterface;
    users.user.set(user);
    TestBed.configureTestingModule({
      imports: [DashboardTodayEditorComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: user },
        { provide: MatDialogRef, useValue: ref },
        { provide: DashboardConfigurationService, useValue: persistence },
        { provide: AppUserService, useValue: users },
        { provide: AppHapticsService, useValue: haptics },
      ],
    });
  });
  const render = () => {
    const fixture = TestBed.createComponent(DashboardTodayEditorComponent);
    fixture.detectChanges();
    return fixture;
  };
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
    reject(new Error('Your dashboard changed.'));
    await pending;
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
        ?.textContent
    ).toContain('Your dashboard changed.');
    expect(user.settings.dashboardSettings.today).toBeUndefined();
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(ref.close).not.toHaveBeenCalled();
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
