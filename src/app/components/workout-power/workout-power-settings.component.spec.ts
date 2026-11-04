import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { WorkoutPowerSettingsComponent } from './workout-power-settings.component';
import { WorkoutPowerSettingsService } from '../../services/workout-power-settings.service';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
const profile = { sport: ActivityTypes.Running, provider: 'suunto' as const, source: 'Watch power',
  reference: { kind: 'critical-power' as const, watts: 250 }, referenceDate: '2026-11-01', zoneUpperBoundsWatts: [150, 200] };
const head = { version: 1 as const, revision: 1, profiles: [profile] };
describe('Workout power settings', () => {
  const load = vi.fn(), save = vi.fn(), selection = vi.fn(), success = vi.fn(), error = vi.fn();
  let component: WorkoutPowerSettingsComponent;
  beforeEach(() => {
    vi.clearAllMocks(); load.mockResolvedValue(head); save.mockResolvedValue({ ...head, revision: 2 });
    TestBed.configureTestingModule({ errorOnUnknownElements: true, errorOnUnknownProperties: true, providers: [{ provide: WorkoutPowerSettingsService, useValue: { load, save } },
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
  it('renders the actual Material controls and generation-only explanation', async () => {
    const fixture = TestBed.createComponent(WorkoutPowerSettingsComponent); fixture.componentRef.setInput('uid', 'owner');
    fixture.componentInstance.sport.set(ActivityTypes.Running); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('not fetched from the service');
    expect(fixture.nativeElement.textContent).toContain('Training load calculations keep their existing values');
    expect(fixture.debugElement.query(By.css('input[formControlName="watts"]')).nativeElement.value).toBe('250');
    expect(fixture.nativeElement.textContent).toContain('Suunto');
    expect(fixture.nativeElement.querySelector('[formControlName="provider"]').textContent).toContain('Suunto');
    if (process.env.WORKOUT_POWER_QA_DIR) {
      const sass = createRequire(createRequire(resolve('package.json')).resolve('@angular/build/package.json'))('sass');
      const css = sass.compileString(`#${fixture.nativeElement.id} {` + readFileSync('src/app/components/workout-power/workout-power-settings.component.scss', 'utf8').replace(/:host/g, '&') + '}').css;
      const markup = fixture.nativeElement.cloneNode(true) as HTMLElement;
      const inputs = [...fixture.nativeElement.querySelectorAll('input')] as HTMLInputElement[];
      markup.querySelectorAll('input').forEach((input, i) => input.setAttribute('value', inputs[i].value));
      for (const dark of [false, true]) writeFileSync(join(process.env.WORKOUT_POWER_QA_DIR, `power-settings${dark ? '-dark' : ''}.html`),
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css">'
        + [...document.head.querySelectorAll('style')].map(style => style.outerHTML).join('') + '<style>' + css + 'main{max-width:800px;margin:auto;padding:16px;box-sizing:border-box}</style></head>'
        + '<body class="app-hydrated' + (dark ? ' dark-theme' : '') + '"><main><h1>Workout power</h1>' + markup.outerHTML + '</main></body></html>');
    }

  });
});
