import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { of, Subject } from 'rxjs';
import { sharedWorkoutFtpReference } from '@shared/workout-power-settings';
import { By } from '@angular/platform-browser';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { WorkoutPowerSettingsComponent } from './workout-power-settings.component';
import { WorkoutPowerSettingsService } from '../../services/workout-power-settings.service';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
const profile = { sport: ActivityTypes.Running, provider: 'suunto' as const, source: 'Watch power',
  reference: { kind: 'critical-power' as const, watts: 250 }, referenceDate: '2026-11-01', zoneUpperBoundsWatts: [150, 200] };
const head = { version: 1 as const, revision: 1, profiles: [profile] };

function exportPowerSettingsQa(element: HTMLElement, name: string): void {
  if (process.env.WORKOUT_POWER_QA_DIR) {
    const sass = createRequire(createRequire(resolve('package.json')).resolve('@angular/build/package.json'))('sass');
    const css = sass.compileString(`#${element.id} {` + readFileSync('src/app/components/workout-power/workout-power-settings.component.scss', 'utf8').replace(/:host/g, '&') + '}').css;
    const markup = element.cloneNode(true) as HTMLElement;
    const inputs = [...element.querySelectorAll('input')] as HTMLInputElement[];
    markup.querySelectorAll('input').forEach((input, i) => input.setAttribute('value', inputs[i].value));
    for (const dark of [false, true]) writeFileSync(join(process.env.WORKOUT_POWER_QA_DIR, `${name}${dark ? '-dark' : ''}.html`),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css">'
      + [...document.head.querySelectorAll('style')].map(style => style.outerHTML).join('') + '<style>' + css + 'main{max-width:800px;margin:auto;padding:16px;box-sizing:border-box}</style></head>'
      + '<body class="app-hydrated' + (dark ? ' dark-theme' : '') + '"><main><h1>Workout power</h1>' + markup.outerHTML + '</main></body></html>');
  }
}

describe('Workout power settings', () => {
  const loadSharedFtp = vi.fn(), open = vi.fn();
  const load = vi.fn(), save = vi.fn(), selection = vi.fn(), success = vi.fn(), error = vi.fn();
  let component: WorkoutPowerSettingsComponent;
  beforeEach(() => {
    vi.clearAllMocks(); loadSharedFtp.mockResolvedValue(null); open.mockReturnValue({ afterClosed: () => of(null) }); load.mockResolvedValue(head); save.mockResolvedValue({ ...head, revision: 2 });
    TestBed.configureTestingModule({ errorOnUnknownElements: true, errorOnUnknownProperties: true, providers: [{ provide: WorkoutPowerSettingsService, useValue: { load, save, loadSharedFtp } },
      { provide: MatDialog, useValue: { open } },
      { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
      { provide: AppUserService, useValue: { user: signal({ uid: 'owner', settings: { unitSettings: {} } }) } },
      { provide: AppHapticsService, useValue: { selection, success, error } }] });
    component = TestBed.runInInjectionContext(() => new WorkoutPowerSettingsComponent()); component.uid = 'owner';
    component.sport.set(ActivityTypes.Running);
  });
  it('loads quietly, retains draft on failure and reports feedback only after save', async () => {
    await component.load(); expect(component.form.controls.watts.value).toBe(250); expect(selection).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled(); component.form.patchValue({ watts: 240 }); component.form.markAsDirty();
    save.mockRejectedValueOnce(Error('Changed elsewhere. Reload.')); await component.save();
    expect(component.form.controls.watts.value).toBe(240); expect(component.form.dirty).toBe(true);
    expect(component.message()).toContain('Changed elsewhere'); expect(error).toHaveBeenCalledOnce(); expect(success).not.toHaveBeenCalled();
    save.mockResolvedValueOnce({ ...head, revision: 2, profiles: [{ ...profile, reference: { ...profile.reference, watts: 240 } }] });
    await component.save(); expect(success).toHaveBeenCalledOnce(); expect(component.form.pristine).toBe(true);
  });
  it('blocks sport changes while dirty and rejects invalid or future values', async () => {
    await component.load(); component.form.markAsDirty(); component.selectSport([ActivityTypes.Cycling]); expect(component.sport()).toBe(ActivityTypes.Running);
    for (const fields of [{ zones: '200, 100' }, { watts: 0 }, { referenceDate: '2999-01-01' }]) {
      component.reset(); component.form.patchValue(fields); component.form.markAsDirty(); expect(component.valid()).toBe(false); await component.save();
    }
    expect(save).not.toHaveBeenCalled(); component.discard(); expect(component.form.pristine).toBe(true); expect(selection).toHaveBeenCalledOnce();
    component.selectSport([ActivityTypes.Cycling]); expect(component.sport()).toBe(ActivityTypes.Cycling); expect(selection).toHaveBeenCalledTimes(2);
    component.selectSport([ActivityTypes.Cycling]); expect(selection).toHaveBeenCalledTimes(2);
  });
  it('ignores a save after the component’s owner changes', async () => {
    await component.load(); let finish!: (head: unknown) => void;
    save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    component.form.patchValue({ watts: 240 }); component.form.markAsDirty(); const pending = component.save();
    component.uid = 'other'; await component.load(); finish(head); await pending;
    expect(success).not.toHaveBeenCalled(); expect(component.busy()).toBe(false); expect(component.form.enabled).toBe(true);
  });
  it('does not allow writes after a failed initial read', async () => {
    load.mockRejectedValueOnce(Error('offline')); await component.load(); await component.save();
    expect(component.head()).toBeNull(); expect(save).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('removes only the selected sport reference', async () => {
    load.mockResolvedValueOnce({ ...head, profiles: [profile, { ...profile, sport: ActivityTypes.Cycling }] });
    await component.load(); await component.save(true);
    expect(save).toHaveBeenCalledWith('owner', expect.anything(), [expect.objectContaining({ sport: ActivityTypes.Cycling })]);
  });
  it('defaults to shared FTP with no duplicate input and preserves explicit opt-in feedback', async () => {
    load.mockResolvedValueOnce({ version: 1, revision: 0, profiles: [] });
    const shared = sharedWorkoutFtpReference(ActivityTypes.Running, { method: 'AUTOMATIC', included: true,
      functionalThresholdPower: 280, revision: 2, effectiveAt: Date.parse('2026-11-01T12:00:00Z') }, Date.now())!;
    loadSharedFtp.mockResolvedValue(shared);
    const fixture = TestBed.createComponent(WorkoutPowerSettingsComponent); fixture.componentRef.setInput('uid', 'owner');
    fixture.componentInstance.sport.set(ActivityTypes.Running); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false)); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Shared Running FTP 280 watt');
    expect(fixture.nativeElement.textContent).toContain('Effective since');
    expect(fixture.nativeElement.querySelector('input[formControlName="watts"]')).toBeNull();
    expect(selection).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    exportPowerSettingsQa(fixture.nativeElement, 'power-shared');
    const add = [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) => button.textContent.includes('Add a source-specific')) as HTMLButtonElement;
    add.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[formControlName="watts"]')).not.toBeNull();
    exportPowerSettingsQa(fixture.nativeElement, 'power-new-override');
    expect(selection).toHaveBeenCalledOnce(); fixture.componentInstance.beginOverride(); expect(selection).toHaveBeenCalledOnce();
    fixture.componentInstance.discard(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[formControlName="watts"]')).toBeNull(); expect(save).not.toHaveBeenCalled();
  });
  it('returns to the shared default only through an explicit override removal', async () => {
    await component.load(); expect(component.editingOverride()).toBe(true); expect(save).not.toHaveBeenCalled();
    save.mockResolvedValueOnce({ version: 1, revision: 2, profiles: [] });
    await component.save(true);
    expect(save).toHaveBeenCalledWith('owner', head, []); expect(component.editingOverride()).toBe(false);
    expect(component.message()).toContain('uses shared FTP');
  });
  it('keeps explicit overrides editable if the independent shared FTP read fails', async () => {
    loadSharedFtp.mockRejectedValueOnce(Error('offline')); await component.load();
    expect(component.sharedError()).toBe(true); expect(component.form.controls.watts.value).toBe(250);
    component.form.patchValue({ watts: 240 }); component.form.markAsDirty(); await component.save();
    expect(save).toHaveBeenCalled();
  });
  it('ignores a stale shared FTP response after the selected sport changes', async () => {
    await component.load(); let finish!: (value: unknown) => void;
    loadSharedFtp.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = component.refreshSharedFtp();
    const cycling = sharedWorkoutFtpReference(ActivityTypes.Cycling, { method: 'AUTOMATIC', included: true,
      functionalThresholdPower: 300, revision: 3, effectiveAt: Date.parse('2026-11-01T12:00:00Z') }, Date.now())!;
    loadSharedFtp.mockResolvedValueOnce(cycling); component.selectSport([ActivityTypes.Cycling]); await Promise.resolve();
    finish(null); await pending; expect(component.sharedFtp()).toEqual(cycling);
  });
  it('opens the existing threshold editor and refreshes its value without changing a power draft', async () => {
    await component.load(); const closed = new Subject<void>(); open.mockReturnValueOnce({ afterClosed: () => closed });
    component.form.patchValue({ watts: 240 }); component.form.markAsDirty();
    const pending = component.editSharedFtp(); await vi.waitFor(() => expect(open).toHaveBeenCalledWith(expect.anything(), { data: { uid: 'owner' } }));
    expect(component.sharedEditorBusy()).toBe(true); await component.editSharedFtp(); expect(open).toHaveBeenCalledOnce();
    closed.next(); closed.complete(); await pending; expect(component.sharedEditorBusy()).toBe(false);
    expect(loadSharedFtp).toHaveBeenCalledTimes(2); expect(component.form.controls.watts.value).toBe(240);
    expect(component.form.dirty).toBe(true); expect(save).not.toHaveBeenCalled(); expect(selection).toHaveBeenCalledOnce();
  });
  it('reports an editor opening failure and permits a deliberate retry', async () => {
    await component.load(); open.mockImplementationOnce(() => { throw Error('unavailable'); });
    await component.editSharedFtp(); expect(component.sharedEditorBusy()).toBe(false);
    expect(component.message()).toContain('could not be opened'); expect(error).toHaveBeenCalledOnce();
    await component.editSharedFtp(); expect(open).toHaveBeenCalledTimes(2); expect(success).not.toHaveBeenCalled();
  });
  it('renders the actual Material controls and generation-only explanation', async () => {
    const fixture = TestBed.createComponent(WorkoutPowerSettingsComponent); fixture.componentRef.setInput('uid', 'owner');
    fixture.componentInstance.sport.set(ActivityTypes.Running); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false)); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('not fetched from the service');
    expect(fixture.nativeElement.textContent).toContain('do not change Training load calibration');
    expect(fixture.nativeElement.textContent).toContain('explicit override below takes precedence');
    expect(fixture.debugElement.query(By.css('input[formControlName="watts"]')).nativeElement.value).toBe('250');
    expect(fixture.nativeElement.textContent).toContain('Suunto');
    expect(fixture.nativeElement.querySelector('[formControlName="provider"]').textContent).toContain('Suunto');
    exportPowerSettingsQa(fixture.nativeElement, 'power-override');

  });
});
