import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { By } from '@angular/platform-browser';
import { CompactSelectComponent } from '../shared/compact-select/compact-select.component';
import { PreferencesSetupDialogComponent } from './preferences-setup-dialog.component';
import { PreferencesSetupService } from '../../services/preferences-setup.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppLocaleService } from '../../services/app.locale.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { buildUnitSettingsForUnitSetupPreset } from '../../helpers/unit-setup-preset.helper';
import { DistanceUnits, PaceUnits, WeightUnits } from '@sports-alliance/sports-lib';
import type { AppUserInterface } from '../../models/app-user.interface';

vi.mock('../training-load/training-thresholds-dialog.component', () => ({
  TrainingThresholdsDialogComponent: class TrainingThresholdsDialogFixture {},
}));

describe('PreferencesSetupDialogComponent', () => {
  let owner: AppUserInterface;
  let state: { ownerRevision: ReturnType<typeof signal<number>>; user: ReturnType<typeof signal<AppUserInterface | null>>; due: ReturnType<typeof signal<boolean>>; busy: ReturnType<typeof signal<boolean>>; error: ReturnType<typeof signal<string>>; complete: ReturnType<typeof vi.fn> };
  let ref: { close: ReturnType<typeof vi.fn>; getState: ReturnType<typeof vi.fn>; disableClose: boolean };
  let haptics: { selection: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    owner = { uid: 'owner', settings: { unitSettings: { ...buildUnitSettingsForUnitSetupPreset('kilometers'), weightUnits: WeightUnits.Pounds, startOfTheWeek: 0 }, appSettings: { unitSetupCompleted: false } } } as AppUserInterface;
    state = { ownerRevision: signal(0), user: signal(owner), due: signal(true), busy: signal(false), error: signal(''), complete: vi.fn().mockResolvedValue(true) };
    ref = { close: vi.fn(), getState: vi.fn().mockReturnValue(MatDialogState.OPEN), disableClose: false }; haptics = { selection: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({ imports: [PreferencesSetupDialogComponent, NoopAnimationsModule], providers: [
      { provide: PreferencesSetupService, useValue: state }, { provide: MAT_DIALOG_DATA, useValue: {user: owner} },
      { provide: MatDialogRef, useValue: ref }, { provide: AppHapticsService, useValue: haptics },
      { provide: AppLocaleService, useValue: { cachePreference: vi.fn().mockReturnValue('unchanged'), reload: vi.fn() } },
      { provide: AppAnalyticsService, useValue: {logEvent: vi.fn()} }, { provide: MatSnackBar, useValue: {open: vi.fn()} },
    ] });
    TestBed.overrideProvider(MatDialog, { useValue: { open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) }) } });
  });
  async function render() { const fixture = TestBed.createComponent(PreferencesSetupDialogComponent); fixture.detectChanges(); await fixture.whenStable(); return fixture; }
  it('renders saved values with real compact controls and changes only accepted choices', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    expect(fixture.nativeElement.textContent).toContain('Pounds (lb)'); expect(fixture.nativeElement.textContent).toContain('Sunday');
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(component.unitPreview().split(' · ')[0]).toBe('Km');
    fixture.nativeElement.querySelectorAll('mat-button-toggle button')[1].click(); fixture.detectChanges();
    expect(component.draft().units.distanceUnits).toBe(DistanceUnits.Miles);
    expect(component.unitPreview().split(' · ')[0]).toBe('mi');
    expect(component.draft().units.weightUnits).toBe(WeightUnits.Pounds);
    expect(component.draft().units.startOfTheWeek).toBe(0); expect(haptics.selection).toHaveBeenCalledOnce();
    const weight = fixture.debugElement.queryAll(By.directive(CompactSelectComponent))[0].componentInstance;
    weight.selectionChange.emit(WeightUnits.Kilograms); fixture.detectChanges();
    expect(component.draft().units.weightUnits).toBe(WeightUnits.Kilograms);
    await component.save();
    expect(state.complete).toHaveBeenCalledWith('owner', expect.objectContaining({ appSettings: {unitSetupCompleted: true}, unitSettings: expect.objectContaining({distanceUnits: DistanceUnits.Miles, weightUnits: WeightUnits.Kilograms}) }), 0);
    expect(ref.close).toHaveBeenCalledOnce();
  });
  it('keeps mixed units on open and prevents empty custom selections from being silently defaulted', async () => {
    owner.settings.unitSettings.paceUnits = [PaceUnits.MinutesPerMile, PaceUnits.MinutesPerKilometer];
    const fixture = await render(); const component = fixture.componentInstance;
    expect(component.preset()).toBeNull(); expect(fixture.nativeElement.textContent).toContain('Custom units');
    component.toggle('units'); component.setUnit('paceUnits', []); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#preferences-custom-units').hidden).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Choose at least one unit');
    await component.save(); expect(state.complete).not.toHaveBeenCalled();
    component.close(); expect(ref.close).toHaveBeenCalledOnce(); expect(owner.settings.unitSettings.paceUnits).toHaveLength(2);
  });
  it('shows pending/error state, blocks closing during writes and retains the draft for retry', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    state.complete.mockResolvedValue(false); component.choosePreset('miles'); await component.save();
    state.error.set('Could not save'); state.busy.set(true); fixture.detectChanges(); await fixture.whenStable();
    expect(ref.disableClose).toBe(true); expect(fixture.nativeElement.textContent).toContain('Saving…');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Could not save');
    component.close(); component.choosePreset('kilometers'); expect(ref.close).not.toHaveBeenCalled(); expect(component.preset()).toBe('miles');
  });
  it('applies regional format only after saving and leaves defaults alone on cancel', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    const locale = TestBed.inject(AppLocaleService);
    component.setPreference('formatLocale', 'fr-FR');
    state.complete.mockResolvedValueOnce(false);
    await component.save(); expect(locale.cachePreference).not.toHaveBeenCalled(); expect(locale.reload).not.toHaveBeenCalled();
    vi.mocked(locale.cachePreference).mockReturnValue('updated');
    await component.save(); expect(locale.cachePreference).toHaveBeenCalledWith('fr-FR'); expect(locale.reload).toHaveBeenCalledOnce();
  });
  it('closes a stale review even if the same account signs in again', async () => {
    const fixture = await render(); state.ownerRevision.set(2); fixture.detectChanges(); await fixture.whenStable();
    expect(ref.close).toHaveBeenCalled();
  });
  it('closes on account change without submitting a draft', async () => {
    const fixture = await render(); state.user.set(null); fixture.detectChanges(); await fixture.whenStable();
    expect(ref.close).toHaveBeenCalled(); expect(state.complete).not.toHaveBeenCalled();
  });
  it('closes an obsolete review when preferences were completed elsewhere', async () => {
    const fixture = await render();
    state.due.set(false); fixture.detectChanges(); await fixture.whenStable();
    expect(ref.close).toHaveBeenCalledOnce();
    expect(state.complete).not.toHaveBeenCalled();
  });
  it('finishes its own save even when the account stream reports completion before the write resolves', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    const locale = TestBed.inject(AppLocaleService);
    component.setPreference('formatLocale', 'fr-FR');
    vi.mocked(locale.cachePreference).mockReturnValue('updated');
    let resolve!: (saved: boolean) => void;
    state.complete.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    const pending = component.save();
    state.due.set(false); fixture.detectChanges(); await fixture.whenStable();
    expect(ref.close).not.toHaveBeenCalled();
    resolve(true); await pending;
    expect(locale.cachePreference).toHaveBeenCalledWith('fr-FR');
    expect(locale.reload).toHaveBeenCalledOnce();
    expect(ref.close).toHaveBeenCalledOnce();
  });
  it('does not open late-loaded thresholds after the parent dialog starts closing', async () => {
    const fixture = await render();
    const loading = fixture.componentInstance.openThresholds();
    // Backdrop/Escape start the Material exit animation before the component is destroyed.
    ref.getState.mockReturnValue(MatDialogState.CLOSING);
    await loading;
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
  });
  it('opens the existing threshold editor with saved units and preserves the preferences draft', async () => {
    const fixture = await render(); const component = fixture.componentInstance;
    component.choosePreset('miles');
    await component.openThresholds();
    expect(TestBed.inject(MatDialog).open).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: { uid: owner.uid, unitSettings: owner.settings.unitSettings },
    }));
    expect(component.draft().units.distanceUnits).toBe(DistanceUnits.Miles);
    expect(component.loadingThresholds()).toBe(false);
    expect(state.complete).not.toHaveBeenCalled();
  });
});
