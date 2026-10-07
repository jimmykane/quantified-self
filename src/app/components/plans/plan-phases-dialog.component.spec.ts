import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import type { TrainingPlanV1 } from '@shared/training-plans';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingPlansService } from '../../services/training-plans.service';
import { PlanPhasesDialogComponent } from './plan-phases-dialog.component';

describe('PlanPhasesDialogComponent', () => {
  const plan: TrainingPlanV1 = { schemaVersion: 1, id: 'plan', name: 'Autumn', lifecycle: 'paused',
    startLocalDate: '2026-10-01', endLocalDate: '2026-10-31', revision: 3, lastCheckpointRevision: 1,
    workoutCount: 1, createdAtMs: 1, updatedAtMs: 1 };
  let close: ReturnType<typeof vi.fn>;
  let selection: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    close = vi.fn(); selection = vi.fn();
    await TestBed.configureTestingModule({ imports: [PlanPhasesDialogComponent], providers: [provideRouter([]),
      { provide: MAT_DIALOG_DATA, useValue: { plan, currentWorkoutDates: ['2026-10-15'] } },
      { provide: MatDialogRef, useValue: { close } },
      { provide: TrainingPlansService, useValue: { createEntityId: vi.fn().mockReturnValue('phase-new') } },
      { provide: AppHapticsService, useValue: { selection } },
    ] }).compileComponents();
  });
  it('keeps initialization, typing and unchanged saves silent; saves stable IDs and clean optional fields', () => {
    const fixture = TestBed.createComponent(PlanPhasesDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    component.save(); expect(close).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
    component.add('Base'); component.update('phase-new', 'description', '   ');
    expect(selection).toHaveBeenCalledOnce();
    component.save();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ kind: 'set-plan-phases',
      phases: { version: 1, items: [{ id: 'phase-new', name: 'Base', startLocalDate: '2026-10-01', endLocalDate: '2026-10-01' }] },
      confirmPlanRangeExtension: false }));
    expect(plan).not.toHaveProperty('phases');
  });
  it('blocks excluded workouts and invalid phases, and requires an explicit extension choice', () => {
    const component = TestBed.createComponent(PlanPhasesDialogComponent).componentInstance;
    component.start.set('2026-10-16'); expect(component.validation().error).toContain('every current workout');
    component.start.set('2026-09-30'); component.add('Taper'); component.save(); expect(close).not.toHaveBeenCalled();
    component.setExtensionConfirmation(true); component.save();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ confirmPlanRangeExtension: true, startLocalDate: '2026-09-30' }));
    close.mockClear(); component.update('phase-new', 'name', ''); component.save(); expect(close).not.toHaveBeenCalled();
  });
  it('removes phases locally and emits one haptic per accepted semantic action', () => {
    const component = TestBed.createComponent(PlanPhasesDialogComponent).componentInstance;
    component.add('Recovery'); component.selectColor('phase-new', 'green'); component.selectColor('phase-new', 'green');
    component.remove('phase-new'); component.remove('phase-new'); component.selectColor('missing', 'blue');
    expect(selection).toHaveBeenCalledTimes(3); expect(component.items()).toEqual([]); expect(component.unchanged()).toBe(true);
  });
  it('retains drafts after a rejected save and locks edits until the request finishes', async () => {
    const component = TestBed.createComponent(PlanPhasesDialogComponent).componentInstance;
    let finish!: (saved: boolean) => void;
    const onSave = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    component.data.onSave = onSave;
    component.add('Build');
    const draft = structuredClone(component.items());
    const pending = component.save();
    expect(component.saving()).toBe(true);
    component.remove('phase-new'); component.update('phase-new', 'name', 'Changed');
    await component.save();
    expect(onSave).toHaveBeenCalledOnce(); expect(component.items()).toEqual(draft);
    finish(false); await pending;
    expect(component.saving()).toBe(false); expect(close).not.toHaveBeenCalled();
    onSave.mockResolvedValueOnce(true);
    await component.save(); expect(close).toHaveBeenCalledOnce();
  });
  it('requires a fresh extension confirmation when the requested range changes', () => {
    const component = TestBed.createComponent(PlanPhasesDialogComponent).componentInstance;
    component.setPlanDate('start', '2026-09-30'); component.setExtensionConfirmation(true);
    component.setPlanDate('end', '2026-11-01');
    expect(component.confirmExtension()).toBe(false);
    component.add('Base'); component.save(); expect(close).not.toHaveBeenCalled();
  });

});
