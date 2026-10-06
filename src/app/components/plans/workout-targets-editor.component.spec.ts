import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
import { ActivityTypes, SpeedUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { AppHapticsService } from '../../services/app.haptics.service';
import { createManualWorkoutEditorTarget, manualEditorTargetToWorkout, workoutTargetToManualEditor, type ManualWorkoutEditorTarget } from '../../helpers/planned-workout-target-editor.helper';
import { WorkoutTargetsEditorComponent } from './workout-targets-editor.component';

@Component({ standalone: true, imports: [WorkoutTargetsEditorComponent], template: `
  <app-workout-targets-editor [targets]="targets()" [sport]="sport" [unitSettings]="units" [disabled]="disabled()"
    (targetsChange)="targets.set($event)"></app-workout-targets-editor>` })
class Host {
  readonly targets = signal<ManualWorkoutEditorTarget[]>([]);
  readonly disabled = signal(false);
  sport: ActivityTypes = ActivityTypes.Cycling;
  readonly units = normalizeUserUnitSettings({ speedUnits: [SpeedUnits.MilesPerHour] });
}

describe('WorkoutTargetsEditorComponent', () => {
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  beforeEach(() => { vi.clearAllMocks(); });
  async function render() {
    await TestBed.configureTestingModule({ imports: [Host], providers: [{ provide: AppHapticsService, useValue: haptics }] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const child = fixture.debugElement.query(By.directive(WorkoutTargetsEditorComponent)).componentInstance as WorkoutTargetsEditorComponent;
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    return { fixture, child, host: fixture.componentInstance, settle };
  }

  it('adds two unique targets, rejects duplicates, reorders and removes with one haptic per accepted action', async () => {
    const { fixture, child, host, settle } = await render();
    expect(haptics.selection).not.toHaveBeenCalled();
    (fixture.nativeElement.querySelector('.targets-heading button') as HTMLButtonElement).click(); await settle();
    child.add(); await settle(); child.add(); child.select(1, 'kind', 'power'); child.select(0, 'kind', 'speed');
    expect(host.targets().map(t => t.kind)).toEqual(['power', 'speed']);
    expect(child.rows()[1].kinds.find(k => k.value === 'power')?.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.targets-heading button').disabled).toBe(true);
    child.move(0, 1); await settle(); child.remove(1); await settle(); child.remove(0); await settle();
    expect(host.targets()).toEqual([]);
    expect(haptics.selection).toHaveBeenCalledTimes(5);
  });

  it('uses semantic selection events, keeps typing silent and requires a reference for relative targets', async () => {
    const { fixture, child, host, settle } = await render();
    host.targets.set([{ ...createManualWorkoutEditorTarget('power'), minimum: 200, maximum: 250 }]); await settle();
    const selects = fixture.debugElement.queryAll(By.directive(MatSelect));
    selects[1].componentInstance.selectionChange.emit({ value: 'relative' }); await settle();
    expect(host.targets()[0]).toMatchObject({ mode: 'relative', minimum: null, maximum: null, referenceValue: null });
    child.select(0, 'mode', 'relative');
    child.number(0, 'minimum', 80); await settle(); child.number(0, 'maximum', 120); await settle();
    expect(() => manualEditorTargetToWorkout(host.targets()[0], host.sport, host.units)).toThrow('positive reference');
    const reference = fixture.nativeElement.querySelector('input[aria-label^="Reference "]') as HTMLInputElement;
    reference.value = '250'; reference.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(child.rows()[0].preview).toContain('200'); expect(child.rows()[0].preview).toContain('300');
    expect(haptics.selection).toHaveBeenCalledOnce();
    child.select(0, 'referenceKind', 'critical-power'); await settle();
    expect(host.targets()[0].referenceValue).toBeNull();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('accepts a keyboard kind selection once and clears the old numeric draft', async () => {
    const { fixture, host, settle } = await render();
    host.targets.set([{ ...createManualWorkoutEditorTarget('power'), minimum: 150, maximum: 170 }]); await settle();
    const select = fixture.debugElement.query(By.directive(MatSelect));
    const trigger = select.nativeElement as HTMLElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true })); await settle();
    expect(host.targets()[0].kind).toBe('speed');
    expect(host.targets()[0].minimum).toBeNull();
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('clears incompatible bounds and snapshots when switching to or from cadence', async () => {
    const { child, host, settle } = await render();
    host.targets.set([workoutTargetToManualEditor({ kind: 'speed', mode: 'absolute', presentation: 'pace',
      minimumMetersPerSecond: 3, maximumMetersPerSecond: 4 }, host.sport, host.units)]); await settle();
    child.select(0, 'kind', 'cadence'); await settle();
    expect(host.targets()[0]).toMatchObject({ kind: 'cadence', minimum: null, maximum: null });
    expect(host.targets()[0].source).toBeUndefined();
    child.number(0, 'minimum', 80); await settle(); child.number(0, 'maximum', 90); await settle();
    child.select(0, 'kind', 'speed'); await settle();
    expect(host.targets()[0]).toMatchObject({ kind: 'speed', presentation: 'speed', minimum: null, maximum: null });
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it.each([
    [ActivityTypes.Swimming, 'Swim pace'], [ActivityTypes.OpenWaterSwimming, 'Swim pace'],
    [ActivityTypes.Rowing, 'Rowing pace'], [ActivityTypes.IndoorRowing, 'Rowing pace'],
  ] as const)('uses the %s pace label and preserves authored cadence without offering a new stroke target', async (sport, label) => {
    const { fixture, child, host, settle } = await render();
    host.sport = sport; await settle(); child.add(); await settle();
    expect(host.targets()[0]).toMatchObject({ kind: 'speed', presentation: 'pace' });
    const presentation = fixture.debugElement.queryAll(By.directive(MatSelect))[2].componentInstance as MatSelect;
    expect(presentation.options.find(option => option.value === 'pace')?.viewValue).toBe(label);
    expect(child.kinds().some(option => option.value === 'cadence')).toBe(false);
    host.targets.set([{ ...createManualWorkoutEditorTarget('cadence'), minimum: 80, maximum: 90 }]); await settle();
    expect(child.rows()[0].kinds.some(option => option.value === 'cadence')).toBe(true);
    const original = host.targets(); child.select(0, 'kind', 'cadence');
    expect(host.targets()).toBe(original); expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('keeps saved references without settings defaults and edits single values consistently', async () => {
    const { child, host, settle } = await render();
    const canonical = { kind: 'speed' as const, mode: 'relative' as const, presentation: 'pace' as const,
      minimumPercent: 80, maximumPercent: 120, reference: { kind: 'threshold-speed' as const, metersPerSecond: 3.1234567890123 } };
    host.targets.set([workoutTargetToManualEditor(canonical, host.sport, host.units)]); await settle();
    expect(child.rows()[0].savedReference).toBe(true); expect(haptics.selection).not.toHaveBeenCalled();
    child.select(0, 'presentation', 'speed'); await settle();
    expect(child.rows()[0].unit).toBe('mph');
    expect(manualEditorTargetToWorkout(host.targets()[0], host.sport, host.units)).toEqual({ ...canonical, presentation: 'speed' });
    child.select(0, 'rangeMode', 'single'); await settle(); child.number(0, 'minimum', 130); await settle();
    expect(manualEditorTargetToWorkout(host.targets()[0], host.sport, host.units)).toMatchObject({ minimumPercent: 130, maximumPercent: 130, reference: canonical.reference });
  });

  it('keeps the saved speed reference through a presentation selection while a percentage is cleared', async () => {
    const { fixture, host, settle } = await render();
    const canonical = { kind: 'speed' as const, mode: 'relative' as const, presentation: 'pace' as const,
      minimumPercent: 80, maximumPercent: 120, reference: { kind: 'threshold-speed' as const, metersPerSecond: 3.1234567890123 } };
    host.targets.set([workoutTargetToManualEditor(canonical, host.sport, host.units)]); await settle();
    const maximum = fixture.nativeElement.querySelector('input[aria-label="Maximum (%)"]') as HTMLInputElement;
    maximum.value = ''; maximum.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(host.targets()[0].maximum).toBeNull();
    fixture.debugElement.queryAll(By.directive(MatSelect))[2].componentInstance.selectionChange.emit({ value: 'speed' }); await settle();
    expect(fixture.nativeElement.textContent).toContain('Saved reference snapshot');
    expect(fixture.nativeElement.querySelector('input[aria-label="Reference mph"]').value).not.toBe('');
    maximum.value = '130'; maximum.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(manualEditorTargetToWorkout(host.targets()[0], host.sport, host.units)).toEqual({ ...canonical, presentation: 'speed', maximumPercent: 130 });
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it.each([false, true])('does not call an unsaved reference a saved snapshot after conversion (reopened: %s)', async reopened => {
    const { child, host, settle } = await render();
    const canonical = { kind: 'speed' as const, mode: 'relative' as const, presentation: 'pace' as const,
      minimumPercent: 80, maximumPercent: 120, reference: { kind: 'threshold-speed' as const, metersPerSecond: 3.1234567890123 } };
    host.targets.set([reopened ? workoutTargetToManualEditor(canonical, host.sport, host.units)
      : { ...createManualWorkoutEditorTarget('speed'), mode: 'relative', minimum: 80, maximum: 120 }]); await settle();
    child.number(0, 'referenceValue', 4.123456789); await settle();
    expect(child.rows()[0].savedReference).toBe(false);
    child.select(0, 'presentation', 'speed'); await settle();
    expect(child.rows()[0].savedReference).toBe(false);
    child.select(0, 'presentation', 'pace'); await settle();
    expect(child.rows()[0].savedReference).toBe(false);
  });

  it('clears converted speed snapshots when selecting another target mode', async () => {
    const { child, host, settle } = await render();
    host.targets.set([{ ...createManualWorkoutEditorTarget('speed'), mode: 'relative', referenceValue: 4.123456789 }]); await settle();
    child.select(0, 'presentation', 'speed'); await settle();
    expect(host.targets()[0].speedSource).toBeDefined();
    child.select(0, 'mode', 'absolute'); await settle();
    expect(host.targets()[0]).toMatchObject({ mode: 'absolute', minimum: null, maximum: null, referenceValue: null });
    expect(host.targets()[0].speedSource).toBeUndefined();
    expect(host.targets()[0].source).toBeUndefined();
  });

  it('ignores every action while saving and leaves the draft intact', async () => {
    const { child, host, settle } = await render();
    host.targets.set([{ ...createManualWorkoutEditorTarget('cadence'), minimum: 80, maximum: 90 }]); host.disabled.set(true); await settle();
    const original = host.targets();
    child.add(); child.remove(0); child.move(0, 1); child.select(0, 'mode', 'relative'); child.number(0, 'minimum', 100);
    expect(host.targets()).toBe(original); expect(haptics.selection).not.toHaveBeenCalled();
  });
});
