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
  readonly sport = ActivityTypes.Cycling;
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
    child.add(); await settle(); child.add(); child.select(1, 'kind', 'heart-rate'); child.select(0, 'kind', 'heart-rate');
    expect(host.targets().map(t => t.kind)).toEqual(['heart-rate', 'power']);
    expect(child.rows()[1].kinds.find(k => k.value === 'heart-rate')?.disabled).toBe(true);
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
    host.targets.set([{ ...createManualWorkoutEditorTarget('heart-rate'), minimum: 150, maximum: 170 }]); await settle();
    const select = fixture.debugElement.query(By.directive(MatSelect));
    const trigger = select.nativeElement as HTMLElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true })); await settle();
    expect(host.targets()[0].kind).toBe('power');
    expect(host.targets()[0].minimum).toBeNull();
    expect(haptics.selection).toHaveBeenCalledOnce();
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

  it('ignores every action while saving and leaves the draft intact', async () => {
    const { child, host, settle } = await render();
    host.targets.set([{ ...createManualWorkoutEditorTarget('cadence'), minimum: 80, maximum: 90 }]); host.disabled.set(true); await settle();
    const original = host.targets();
    child.add(); child.remove(0); child.move(0, 1); child.select(0, 'mode', 'relative'); child.number(0, 'minimum', 100);
    expect(host.targets()).toBe(original); expect(haptics.selection).not.toHaveBeenCalled();
  });
});
