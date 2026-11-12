import { TestBed } from '@angular/core/testing';
import { DistanceUnits, SpeedUnits, PaceUnits, SwimPaceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
import { MatFormField } from '@angular/material/form-field';
import { BehaviorSubject } from 'rxjs';
import { TrainingLoadSettingsComponent } from './training-load-settings.component';
import { TrainingLoadService, type TrainingLoadPolicyHead } from '../../services/training-load.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppUserService } from '../../services/app.user.service';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TrainingThresholdsDialogComponent } from './training-thresholds-dialog.component';

describe('dated Training load settings', () => {
  const savePolicy = vi.fn(); const success = vi.fn(); const error = vi.fn();
  const readFtpSuggestions = vi.fn(); const selection = vi.fn();
  let component: TrainingLoadSettingsComponent;
  let policies$: BehaviorSubject<TrainingLoadPolicyHead[]>;
  beforeEach(() => {
    vi.clearAllMocks(); savePolicy.mockResolvedValue(undefined); readFtpSuggestions.mockResolvedValue({});
    policies$ = new BehaviorSubject<TrainingLoadPolicyHead[]>([
      { id: 'walking-hiking', revision: 4, method: 'HR', included: false },
    ]);
    TestBed.configureTestingModule({ providers: [
      { provide: TrainingLoadService, useValue: { savePolicy, readFtpSuggestions, watchPolicies: () => policies$ } },
      { provide: AppHapticsService, useValue: { success, error, selection } },
    ] });
    component = TestBed.runInInjectionContext(() => new TrainingLoadSettingsComponent());
    component.uid = 'owner'; component.ngOnChanges();
  });
  it.each([false, true])('offers FTP as a draft proposal, requiring Save (Health editor: %s)', async thresholdsOnly => {
    component.ngOnDestroy();
    policies$.next([{ id: 'cycling', revision: 5, method: 'HR', included: false,
      functionalThresholdPower: 200, lactateThresholdHR: 165 }]);
    readFtpSuggestions.mockResolvedValueOnce({ cycling: { value: 222.5,
      displayText: '223 watt', detailText: 'Garmin · last seen Nov 4, 2026' } });
    const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
    fixture.componentRef.setInput('uid', 'owner'); fixture.componentRef.setInput('thresholdsOnly', thresholdsOnly);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const instance = fixture.componentInstance, row = instance.rows.find(row => row.id === 'cycling')!;
    expect(row.form.controls.ftp.value).toBe('200'); expect(row.form.pristine).toBe(true);
    expect(savePolicy).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
    const family = fixture.nativeElement.querySelector('section[aria-label="Cycling"]') as HTMLElement;
    expect(family.textContent).toContain('Found in recent activities:');
    expect(family.textContent).toContain('older setting'); expect(family.textContent).toContain('not a new FTP test');
    const use = family.querySelector('button[aria-label="Use Cycling FTP from recent activities"]') as HTMLButtonElement;
    use.click(); fixture.detectChanges();
    expect(row.form.controls.ftp.value).toBe('222.5'); expect(row.form.dirty).toBe(true);
    expect(row.form.controls.thresholdHr.value).toBe('165'); expect(row.form.controls.included.value).toBe(false);
    expect(savePolicy).not.toHaveBeenCalled(); expect(selection).toHaveBeenCalledOnce(); expect(use.disabled).toBe(true);
    await instance.save(row);
    expect(savePolicy).toHaveBeenCalledExactlyOnceWith('owner', 'cycling', 5,
      { method: 'HR', included: false, functionalThresholdPower: 222.5, lactateThresholdHR: 165 });
    fixture.destroy();
  });
  it.each([false, true])('keeps empty HR labels above their unit suffixes (Health editor: %s)', async thresholdsOnly => {
    component.ngOnDestroy(); policies$.next([]);
    const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
    fixture.componentRef.setInput('uid', 'owner'); fixture.componentRef.setInput('thresholdsOnly', thresholdsOnly);
    fixture.detectChanges(); await fixture.whenStable();
    const family = fixture.debugElement.query(By.css('section[aria-label="Cycling"]'));
    for (const name of ['thresholdHr', 'restingHr', 'maxHr']) {
      const field = family.queryAll(By.directive(MatFormField)).find(field => field.query(By.css(`input[formControlName="${name}"]`)))!;
      expect(field.componentInstance.floatLabel).toBe('always');
      expect(field.query(By.css('input')).nativeElement.value).toBe('');
      expect(field.nativeElement.textContent).toContain('bpm');
    }
    expect(selection).not.toHaveBeenCalled(); expect(savePolicy).not.toHaveBeenCalled(); fixture.destroy();
  });
  it.each([false, true])('edits manual HR calibration and formula only on Save (Health editor: %s)', async thresholdsOnly => {
    component.ngOnDestroy();
    policies$.next([{ id: 'cycling', revision: 5, method: 'MET', included: false,
      lactateThresholdHR: 165, restingHeartRate: 55, maxHeartRate: 190, hrAlgorithm: 'BANISTER' }]);
    const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
    fixture.componentRef.setInput('uid', 'owner'); fixture.componentRef.setInput('thresholdsOnly', thresholdsOnly);
    fixture.detectChanges(); await fixture.whenStable();
    const row = fixture.componentInstance.rows.find(row => row.id === 'cycling')!;
    expect(row.form.pristine).toBe(true); expect(selection).not.toHaveBeenCalled();
    expect(row.form.controls.hrAlgorithm.value).toBe('BANISTER');
    expect(fixture.nativeElement.textContent).toContain('Maximum HR alone is insufficient');
    row.form.controls.restingHr.setValue('60'); row.form.markAsDirty();
    await fixture.componentInstance.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'cycling', 5,
      { method: 'MET', included: false, lactateThresholdHR: 165, restingHeartRate: 60, maxHeartRate: 190, hrAlgorithm: 'BANISTER' });
    row.form.controls.maxHr.setValue('160'); row.form.markAsDirty();
    expect(fixture.componentInstance.validThresholds(row)).toBe(false);
    await fixture.componentInstance.save(row); expect(savePolicy).toHaveBeenCalledOnce();
    row.form.controls.maxHr.setValue(''); row.form.controls.hrAlgorithm.setValue('');
    await fixture.componentInstance.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'cycling', 6,
      { method: 'MET', included: false, lactateThresholdHR: 165, restingHeartRate: 60 });
    fixture.destroy();
  });
  it('saves independently measured running pace and preserves precision through unit changes', async () => {
    const speed = 3.7123456789;
    policies$.next([{ id: 'running', revision: 4, method: 'HR', included: true, runningThresholdSpeed: speed }]);
    const row = component.rows.find(row => row.id === 'running')!;
    component.changeRunningPaceUnit(row, 'mi'); component.changeRunningPaceUnit(row, 'km');
    expect(row.form.pristine).toBe(true);
    row.form.controls.method.setValue('RUNNING_PACE'); row.form.markAsDirty();
    await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'running', 4,
      { method: 'RUNNING_PACE', included: true, runningThresholdSpeed: speed });
    row.form.controls.runningPace.setValue('04:30'); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy.mock.calls.at(-1)?.[3].runningThresholdSpeed).toBeCloseTo(1000 / 270, 12);
    component.changeRunningPaceUnit(row, 'mi');
    row.form.controls.runningPace.setValue('08:00'); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy.mock.calls.at(-1)?.[3].runningThresholdSpeed).toBeCloseTo(1609.34 / 480, 12);
  });
  it.each([
    ['running', 'runningPace', 'runningThresholdSpeed', 1000],
    ['swimming', 'cssPace', 'swimThresholdSpeed', 100],
  ] as const)('keeps the displayed hour-format %s pace editable without losing saved precision', async (family, control, property, distance) => {
    const speed = distance / 3659.6;
    policies$.next([{ id: family, revision: 2, method: 'HR', included: true, [property]: speed }]);
    const row = component.rows.find(row => row.id === family)!;
    expect(row.form.controls[control].value).toBe('01:01:00');
    row.form.controls[control].setValue('61:00'); row.form.markAsDirty();
    await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', family, 2,
      { method: 'HR', included: true, [property]: speed });
    row.form.controls[control].setValue('01:01:01'); row.form.markAsDirty();
    expect(component.validThresholds(row)).toBe(true); await component.save(row);
    expect(savePolicy.mock.calls.at(-1)?.[3][property]).toBeCloseTo(distance / 3661, 12);
  });
  it.each([
    ['running', 'runningPace', '7:40', 'runningThresholdSpeed', 3.5],
    ['swimming', 'cssPace', '1:43', 'swimThresholdSpeed', 100 / 113],
  ] as const)('preserves exact %s threshold when only minute zero padding changes', async (family, control, text, property, speed) => {
    component.unitSettings = normalizeUserUnitSettings({
      paceUnits: [PaceUnits.MinutesPerMile], swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
    });
    component.ngOnChanges();
    policies$.next([{ id: family, revision: 2, method: 'HR', included: true, [property]: speed }]);
    const row = component.rows.find(row => row.id === family)!;
    row.form.controls[control].setValue(text); row.form.markAsDirty();
    await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', family, 2,
      { method: 'HR', included: true, [property]: speed });
  });
  it.each([
    ['running', 'runningPace'], ['swimming', 'cssPace'],
  ] as const)('rejects invalid %s pace when the saved threshold is empty', async (family, control) => {
    const row = component.rows.find(row => row.id === family)!;
    row.form.controls[control].setValue('00000'); row.form.markAsDirty();
    expect(component.validThresholds(row)).toBe(false); await component.save(row);
    expect(savePolicy).not.toHaveBeenCalled();
  });
  it('rejects invalid running pace and removes a cleared fallback only on Save', async () => {
    const row = component.rows.find(row => row.id === 'running')!;
    row.form.controls.runningPace.setValue('04:99'); row.form.markAsDirty();
    expect(component.validThresholds(row)).toBe(false); await component.save(row);
    expect(savePolicy).not.toHaveBeenCalled();
    component.changeRunningPaceUnit(row, 'mi'); expect(row.runningPaceUnit).toBe('km');
    row.form.controls.runningPace.setValue(''); await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'running', 0, { method: 'AUTOMATIC', included: true });
  });
  it.each([false, true])('starts in the owner pace preferences without changing canonical values (Health editor: %s)', async thresholdsOnly => {
    component.ngOnDestroy(); readFtpSuggestions.mockClear();
    policies$.next([
      { id: 'running', revision: 2, method: 'RUNNING_PACE', included: true, runningThresholdSpeed: 3.5 },
      { id: 'swimming', revision: 3, method: 'SWIM_PACE', included: true, swimThresholdSpeed: 100 / 113 },
    ]);
    const watch = vi.spyOn(TestBed.inject(TrainingLoadService), 'watchPolicies');
    const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
    fixture.componentRef.setInput('uid', 'owner'); fixture.componentRef.setInput('thresholdsOnly', thresholdsOnly);
    fixture.componentRef.setInput('unitSettings', normalizeUserUnitSettings({
      paceUnits: [PaceUnits.MinutesPerMile], swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
    }));
    fixture.detectChanges(); await fixture.whenStable();
    const instance = fixture.componentInstance, running = instance.rows.find(row => row.id === 'running')!, swimming = instance.rows.find(row => row.id === 'swimming')!;
    instance.selectedFamily.set('running'); fixture.detectChanges();
    expect(running.runningPaceUnit).toBe('mi'); expect(running.form.controls.runningPace.value).toBe('07:40');
    expect(swimming.cssUnit).toBe('yd'); expect(swimming.form.controls.cssPace.value).toBe('01:43');
    const input = fixture.nativeElement.querySelector('input[formControlName="runningPace"]') as HTMLInputElement;
    expect(input.placeholder).toBe('7:15'); expect(input.closest('section')?.textContent).toContain('mm:ss per mile');
    expect(watch).toHaveBeenCalledOnce(); expect(readFtpSuggestions).toHaveBeenCalledOnce();
    expect(selection).not.toHaveBeenCalled(); expect(savePolicy).not.toHaveBeenCalled();
    running.form.controls.ftp.setValue('250'); running.form.markAsDirty(); await instance.save(running);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'running', 2,
      { method: 'RUNNING_PACE', included: true, runningThresholdSpeed: 3.5, functionalThresholdPower: 250 });
  });
  it('updates pristine units silently without reloading policies or reinterpreting a dirty draft', () => {
    component.ngOnDestroy(); readFtpSuggestions.mockClear();
    policies$.next([
      { id: 'running', revision: 2, method: 'HR', included: true, runningThresholdSpeed: 3.5 },
      { id: 'swimming', revision: 3, method: 'SWIM_PACE', included: true, swimThresholdSpeed: 100 / 113 },
    ]);
    const watch = vi.spyOn(TestBed.inject(TrainingLoadService), 'watchPolicies');
    const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
    fixture.componentRef.setInput('uid', 'owner'); fixture.detectChanges();
    const running = fixture.componentInstance.rows.find(row => row.id === 'running')!;
    const swimming = fixture.componentInstance.rows.find(row => row.id === 'swimming')!;
    running.form.controls.runningPace.setValue('04:30'); running.form.markAsDirty();
    fixture.componentRef.setInput('unitSettings', normalizeUserUnitSettings({
      paceUnits: [PaceUnits.MinutesPerMile], swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
    })); fixture.detectChanges();
    expect(running.runningPaceUnit).toBe('km'); expect(running.form.controls.runningPace.value).toBe('04:30');
    expect(swimming.cssUnit).toBe('yd'); expect(swimming.form.controls.cssPace.value).toBe('01:43');
    expect(watch).toHaveBeenCalledOnce(); expect(readFtpSuggestions).toHaveBeenCalledOnce();
    expect(selection).not.toHaveBeenCalled(); expect(savePolicy).not.toHaveBeenCalled();
  });
  it('keeps an explicit input-unit choice when unrelated profile units change', () => {
    component.ngOnDestroy();
    policies$.next([{ id: 'running', revision: 2, method: 'HR', included: true, runningThresholdSpeed: 3.5 }]);
    const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
    fixture.componentRef.setInput('uid', 'owner'); fixture.detectChanges();
    const row = fixture.componentInstance.rows.find(row => row.id === 'running')!;
    fixture.componentInstance.changeRunningPaceUnit(row, 'mi');
    fixture.componentRef.setInput('unitSettings', normalizeUserUnitSettings({ swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] }));
    fixture.detectChanges();
    expect(row.runningPaceUnit).toBe('mi'); expect(row.form.controls.runningPace.value).toBe('07:40');
    expect(row.form.pristine).toBe(true); expect(selection).toHaveBeenCalledOnce(); expect(savePolicy).not.toHaveBeenCalled();
  });
  it('uses pace preferences independently of distance and speed preferences', () => {
    component.unitSettings = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles,
      speedUnits: [SpeedUnits.MilesPerHour], paceUnits: [PaceUnits.MinutesPerKilometer] });
    component.ngOnChanges();
    expect(component.rows.find(row => row.id === 'running')!.runningPaceUnit).toBe('km');
    expect(component.rows.find(row => row.id === 'swimming')!.cssUnit).toBe('m');
  });
  it('shows Saving next to the edited values until the save actually succeeds', async () => {
    component.ngOnDestroy(); let finish!: () => void;
    savePolicy.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
    fixture.componentRef.setInput('uid', 'owner'); fixture.detectChanges();
    const row = fixture.componentInstance.rows.find(row => row.id === 'running')!;
    row.form.controls.ftp.setValue('250'); row.form.markAsDirty();
    const pending = fixture.componentInstance.save(row); fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('section[aria-label="Running"] button[mat-stroked-button]') as HTMLButtonElement;
    try {
      expect(button.textContent).toContain('Saving Running'); expect(button.disabled).toBe(true);
      expect(success).not.toHaveBeenCalled();
    } finally { finish(); await pending; }
    fixture.detectChanges();
    expect(button.textContent).toContain('Save Running preferences'); expect(success).toHaveBeenCalledOnce();
  });
  it('ignores late suggestions for a previous account or destroyed editor without changing drafts', async () => {
    let finish!: (value: { cycling: { value: number; displayText: string; detailText: string } }) => void;
    readFtpSuggestions.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    component.uid = 'old'; component.ngOnChanges();
    component.uid = 'new'; component.ngOnChanges(); await Promise.resolve();
    const row = component.rows.find(row => row.id === 'cycling')!;
    row.form.controls.ftp.setValue('250'); row.form.controls.ftp.markAsDirty();
    finish({ cycling: { value: 222, displayText: '222 watt', detailText: 'Old account' } }); await Promise.resolve();
    expect(component.ftpSuggestions()).toEqual({}); expect(row.form.controls.ftp.value).toBe('250');
    expect(savePolicy).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
    readFtpSuggestions.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    component.ngOnChanges(); component.ngOnDestroy();
    finish({ cycling: { value: 222, displayText: '222 watt', detailText: 'Destroyed editor' } }); await Promise.resolve();
    expect(component.ftpSuggestions()).toEqual({});
  });
  it('keeps repeated, busy and missing suggestion actions silent', () => {
    const row = component.rows.find(row => row.id === 'cycling')!;
    component.useFtpSuggestion(row);
    component.ftpSuggestions.set({ cycling: { value: 222, displayText: '222 watt', detailText: '' } });
    row.form.controls.ftp.setValue('222.0'); component.useFtpSuggestion(row);
    component.busy.set('running'); row.form.controls.ftp.setValue('200'); component.useFtpSuggestion(row);
    expect(row.form.controls.ftp.value).toBe('200'); expect(row.form.pristine).toBe(true);
    expect(selection).not.toHaveBeenCalled(); expect(savePolicy).not.toHaveBeenCalled();
  });
  it('preserves a draft typed while the optional suggestion is loading', async () => {
    let finish!: (value: { cycling: { value: number; displayText: string; detailText: string } }) => void;
    readFtpSuggestions.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    component.ngOnChanges();
    const row = component.rows.find(row => row.id === 'cycling')!;
    row.form.controls.ftp.setValue('250'); row.form.controls.ftp.markAsDirty();
    finish({ cycling: { value: 222, displayText: '222 watt', detailText: 'Garmin' } }); await Promise.resolve();
    expect(component.ftpSuggestions().cycling?.value).toBe(222);
    expect(row.form.controls.ftp.value).toBe('250'); expect(row.form.dirty).toBe(true);
    expect(savePolicy).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
  });
  it('closes the shared Health editor when its account changes without haptic feedback', () => {
    component.ngOnDestroy(); TestBed.resetTestingModule();
    const user$ = new BehaviorSubject<{ uid: string } | null>({ uid: 'owner' });
    const close = vi.fn();
    TestBed.configureTestingModule({ providers: [
      { provide: AppUserService, useValue: { user$ } },
      { provide: MAT_DIALOG_DATA, useValue: { uid: 'owner' } },
      { provide: MatDialogRef, useValue: { close } },
      { provide: AppHapticsService, useValue: { selection: vi.fn() } },
    ] });
    TestBed.runInInjectionContext(() => new TrainingThresholdsDialogComponent());
    expect(close).not.toHaveBeenCalled();
    user$.next({ uid: 'other-owner' });
    expect(close).toHaveBeenCalledOnce(); expect(success).not.toHaveBeenCalled();
  });
  it('loads existing defaults quietly and saves only a changed family with its revision', async () => {
    const row = component.rows.find(row => row.id === 'walking-hiking')!;
    expect(row.form.getRawValue()).toEqual({ method: 'HR', included: false, cssPace: '', runningPace: '', ftp: '', thresholdHr: '', restingHr: '', maxHr: '', hrAlgorithm: '' });
    await component.save(row); expect(savePolicy).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
    row.form.patchValue({ included: true }); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy).toHaveBeenCalledWith('owner', 'walking-hiking', 4, { method: 'HR', included: true });
    expect(row.revision).toBe(5); expect(row.form.pristine).toBe(true); expect(success).toHaveBeenCalledOnce();
  });
  it('shares thresholds with Health while preserving method and inclusion', async () => {
    component.thresholdsOnly = true;
    policies$.next([{ id: 'cycling', revision: 5, method: 'MET', included: false,
      functionalThresholdPower: 220.5, lactateThresholdHR: 165 }]);
    const row = component.rows.find(row => row.id === 'cycling')!;
    expect(component.visibleRows.map(row => row.id)).toEqual(['cycling']);
    row.form.controls.thresholdHr.setValue('166'); row.form.markAsDirty();
    await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'cycling', 5,
      { method: 'MET', included: false, functionalThresholdPower: 220.5, lactateThresholdHR: 166 });
    row.form.patchValue({ ftp: '', thresholdHr: '', restingHr: '', maxHr: '', hrAlgorithm: '' }); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'cycling', 6, { method: 'MET', included: false });
  });
  it('rejects invalid thresholds without a write and keeps sport FTP values independent', async () => {
    const row = component.rows.find(row => row.id === 'running')!;
    for (const value of ['0', '-1', 'NaN', 'Infinity']) {
      row.form.controls.ftp.setValue(value); row.form.markAsDirty(); await component.save(row);
    }
    expect(savePolicy).not.toHaveBeenCalled();
    row.form.patchValue({ ftp: '250', thresholdHr: '165' }); await component.save(row);
    expect(savePolicy).toHaveBeenCalledWith('owner', 'running', 0,
      { method: 'AUTOMATIC', included: true, functionalThresholdPower: 250, lactateThresholdHR: 165 });
    expect(component.rows.find(row => row.id === 'cycling')!.form.controls.ftp.value).toBe('');
  });
  it('retains a conflicting draft for review without claiming that it saved', async () => {
    const row = component.rows[0]; row.form.patchValue({ method: 'MET' }); row.form.markAsDirty();
    savePolicy.mockRejectedValueOnce(new Error('Preferences changed elsewhere.'));
    await component.save(row);
    expect(row.form.dirty).toBe(true); expect(row.form.controls.method.value).toBe('MET');
    expect(component.message()).toContain('changed elsewhere'); expect(error).toHaveBeenCalledOnce(); expect(success).not.toHaveBeenCalled();
  });
  it('shows a newer policy received during a successful save and uses its revision for the next edit', async () => {
    let finish!: () => void;
    savePolicy.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const row = component.rows.find(row => row.id === 'walking-hiking')!;
    row.form.patchValue({ included: true }); row.form.markAsDirty();
    const pending = component.save(row);
    policies$.next([{ id: row.id, revision: 5, method: 'HR', included: true }]);
    policies$.next([{ id: row.id, revision: 6, method: 'MET', included: false }]);
    finish(); await pending;
    expect(row.revision).toBe(6);
    expect(row.form.getRawValue()).toEqual({ method: 'MET', included: false, cssPace: '', runningPace: '', ftp: '', thresholdHr: '', restingHr: '', maxHr: '', hrAlgorithm: '' });
    expect(row.form.pristine).toBe(true);
    row.form.patchValue({ included: true }); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', row.id, 6, { method: 'MET', included: true });
  });
  it.each(['resolve', 'reject'] as const)('ignores an old account save that later %ss while the new account saves', async outcome => {
    let finish!: () => void;
    savePolicy.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finish = outcome === 'resolve' ? resolve : () => reject(new Error('Old account failure'));
    }));
    const row = component.rows.find(row => row.id === 'walking-hiking')!;
    row.form.patchValue({ included: true }); row.form.markAsDirty();
    const oldSave = component.save(row);
    policies$ = new BehaviorSubject<TrainingLoadPolicyHead[]>([
      { id: row.id, revision: 9, method: 'MET', included: false },
    ]);
    component.uid = 'next-owner'; component.ngOnChanges();
    expect(row.form.enabled).toBe(true); expect(component.busy()).toBeNull();
    let finishNew!: () => void;
    savePolicy.mockImplementationOnce(() => new Promise<void>(resolve => { finishNew = resolve; }));
    row.form.patchValue({ included: true }); row.form.markAsDirty();
    const newSave = component.save(row);
    finish(); await oldSave;
    expect(row.revision).toBe(9); expect(row.form.dirty).toBe(true); expect(row.form.disabled).toBe(true);
    expect(component.busy()).toBe(row.id); expect(component.message()).toBe('');
    expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    finishNew(); await newSave;
    expect(savePolicy).toHaveBeenLastCalledWith('next-owner', row.id, 9, { method: 'MET', included: true });
    expect(row.revision).toBe(10); expect(component.busy()).toBeNull(); expect(success).toHaveBeenCalledOnce();
  });
  it.each(['resolve', 'reject'] as const)('keeps a destroyed editor silent when its save later %ss', async outcome => {
    let finish!: () => void;
    savePolicy.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finish = outcome === 'resolve' ? resolve : () => reject(new Error('Late failure'));
    }));
    const row = component.rows.find(row => row.id === 'walking-hiking')!;
    row.form.patchValue({ included: true }); row.form.markAsDirty();
    const pending = component.save(row);
    component.ngOnDestroy(); expect(policies$.observed).toBe(false);
    finish(); await pending;
    expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(component.message()).toBe(''); expect(row.revision).toBe(4);
  });
});


describe('CSS input and units', () => {
  it.each([
    ['1:53', 113, '02:04', '01:53'],
    ['1:54', 114, '02:05', '01:54'],
  ] as const)('preserves CSS entered as %s per 100 yards through saving and reopening', async (input, seconds, metricLabel, yardLabel) => {
    const policies$ = new BehaviorSubject<TrainingLoadPolicyHead[]>([]);
    const savePolicy = vi.fn().mockImplementation(async (_uid, id, revision, policy) => {
      policies$.next([{ ...policy, id, revision: revision + 1 }]);
    });
    const selection = vi.fn();
    TestBed.configureTestingModule({ providers: [
      { provide: TrainingLoadService, useValue: { savePolicy, readFtpSuggestions: vi.fn().mockResolvedValue({}), watchPolicies: () => policies$ } },
      { provide: AppHapticsService, useValue: { success: vi.fn(), error: vi.fn(), selection } },
    ] });
    const open = () => {
      const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
      fixture.componentRef.setInput('uid', 'owner'); fixture.detectChanges();
      return fixture;
    };
    const fixture = open();
    const row = fixture.componentInstance.rows.find(row => row.id === 'swimming')!;
    const swimming = fixture.debugElement.query(By.css('section[aria-label="Swimming"]'));
    const unit = swimming.query(By.css('mat-select:not([formControlName])')).componentInstance as MatSelect;
    expect(selection).not.toHaveBeenCalled();
    unit.selectionChange.emit({ source: unit, value: 'yd' }); fixture.detectChanges();
    expect(swimming.nativeElement.textContent).toContain('mm:ss per 100 yd');
    const pace = swimming.query(By.css('input[formControlName="cssPace"]')).nativeElement as HTMLInputElement;
    pace.value = input; pace.dispatchEvent(new Event('input'));
    expect(row.form.dirty).toBe(true);
    await fixture.componentInstance.save(row);
    // 100 yards is exactly 91.44 metres. The same time in metres would be a different CSS.
    const speed = 91.44 / seconds;
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'swimming', 0,
      { method: 'AUTOMATIC', included: true, swimThresholdSpeed: speed });
    expect(selection).toHaveBeenCalledOnce();
    fixture.destroy();

    const reopened = open();
    const saved = reopened.componentInstance.rows.find(row => row.id === 'swimming')!;
    expect(saved.form.controls.cssPace.value).toBe(metricLabel);
    for (let i = 0; i < 10; i++) {
      reopened.componentInstance.changeCssUnit(saved, 'yd');
      expect(saved.form.controls.cssPace.value).toBe(yardLabel);
      reopened.componentInstance.changeCssUnit(saved, 'm');
      expect(saved.form.controls.cssPace.value).toBe(metricLabel);
    }
    expect(saved.form.pristine).toBe(true);
    saved.form.controls.included.setValue(false); saved.form.markAsDirty();
    await reopened.componentInstance.save(saved);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'swimming', 1,
      { method: 'AUTOMATIC', included: false, swimThresholdSpeed: speed });
    reopened.destroy();
  });
  it('renders CSS inputs and the pace choice only in the Swimming family', () => {
    TestBed.configureTestingModule({ providers: [
      { provide: TrainingLoadService, useValue: { readFtpSuggestions: vi.fn().mockResolvedValue({}), watchPolicies: () => new BehaviorSubject([]), savePolicy: vi.fn() } },
      { provide: AppHapticsService, useValue: { success: vi.fn(), error: vi.fn(), selection: vi.fn() } },
    ] });
    const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
    fixture.componentRef.setInput('uid', 'owner'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('input[formControlName="cssPace"]').length).toBe(1);
    const swimming = fixture.nativeElement.querySelector('section[aria-label="Swimming"]');
    expect(swimming.textContent).toContain('Critical swim speed');
    expect(swimming.textContent).toContain('Automatic prefers CSS pace, then calibrated HR, then MET.');
    expect(swimming.textContent).toContain('Power is not used for swimming TSS.');
    const choices = fixture.debugElement.queryAll(By.directive(MatSelect))
      .flatMap(element => (element.componentInstance as MatSelect).options.toArray().map(option => option.value));
    expect(choices.filter(value => value === 'SWIM_PACE')).toHaveLength(1);
    fixture.destroy();
  });
  it('saves CSS canonically, converts yards without drift, and allows removal only for future swims', async () => {
    const savePolicy = vi.fn().mockResolvedValue(undefined);
    const policies$ = new BehaviorSubject<TrainingLoadPolicyHead[]>([]);
    TestBed.configureTestingModule({ providers: [
      { provide: TrainingLoadService, useValue: { savePolicy, readFtpSuggestions: vi.fn().mockResolvedValue({}), watchPolicies: () => policies$ } },
      { provide: AppHapticsService, useValue: { success: vi.fn(), error: vi.fn(), selection: vi.fn() } },
    ] });
    const component = TestBed.runInInjectionContext(() => new TrainingLoadSettingsComponent());
    component.uid = 'owner'; component.ngOnChanges();
    const row = component.rows.find(row => row.id === 'swimming')!;
    for (const text of ['0:00', '1:60', 'garbage', '-1:00']) {
      row.form.controls.cssPace.setValue(text); row.form.markAsDirty();
      expect(component.validCss(row)).toBe(false); await component.save(row);
    }
    expect(savePolicy).not.toHaveBeenCalled();
    row.form.patchValue({ method: 'SWIM_PACE', cssPace: '1:53' });
    component.changeCssUnit(row, 'yd'); expect(row.form.controls.cssPace.value).toBe('01:43');
    component.changeCssUnit(row, 'm'); expect(row.form.controls.cssPace.value).toBe('01:53');
    await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'swimming', 0,
      { method: 'SWIM_PACE', included: true, swimThresholdSpeed: 100 / 113 });
    // Changing another preference must not quantize the saved speed to displayed seconds.
    policies$.next([{ id: 'swimming', revision: 2, method: 'AUTOMATIC', included: true, swimThresholdSpeed: 0.888888 }]);
    row.form.patchValue({ included: false }); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'swimming', 2,
      { method: 'AUTOMATIC', included: false, swimThresholdSpeed: 0.888888 });
    row.form.controls.cssPace.setValue(''); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'swimming', 3, { method: 'AUTOMATIC', included: false });
    component.ngOnDestroy();
  });
});
