import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { of } from 'rxjs';
import { TrainingLoadDialogComponent } from './training-load-dialog.component';
import { TrainingLoadService } from '../../services/training-load.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { defaultAppliedTrainingLoadPolicy } from '@shared/training-load-policy';
import { browserTrainingLoadSourceFingerprint } from '@shared/training-load-source';

describe('Training load editor', () => {
  const save = vi.fn(); const selection = vi.fn(); const success = vi.fn(); const error = vi.fn();
  const watch = vi.fn();
  const source = { startDate: 1000, endDate: 3601000, stats: { 'Training Stress Score': 87.3 } };
  let component: TrainingLoadDialogComponent;
  beforeEach(async () => {
    vi.clearAllMocks(); save.mockResolvedValue(undefined);
    watch.mockReturnValue(of(null)); vi.stubGlobal('crypto', webcrypto);
    TestBed.configureTestingModule({ providers: [
      { provide: MAT_DIALOG_DATA, useValue: { user: { uid: 'u' }, event: { getID: () => 'e',
        getActivities: () => [{ getID: () => 'walk', type: 'Walking', toJSON: () => source, getStat: () => ({ getValue: () => 87.3 }) }],
        toJSON: () => source, getStat: () => ({ getValue: () => 87.3 }) } } },
      { provide: MatDialogRef, useValue: { close: vi.fn() } },
      { provide: TrainingLoadService, useValue: { save, watch, watchPolicies: () => of([]) } },
      { provide: AppHapticsService, useValue: { selection, success, error } },
    ] });
    component = TestBed.runInInjectionContext(() => new TrainingLoadDialogComponent());
    await component.ngOnInit();
  });
  afterEach(() => vi.unstubAllGlobals());
  it('keeps initialization and unchanged actions silent, and displays one decimal', async () => {
    component.selectLeg('walk'); await component.save();
    expect(selection).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect(component.score(87.3)).toContain('87.3'); expect(component.score(0)).toContain('0.0');
  });
  it('saves zero with success feedback only after persistence and copies no override to future defaults', async () => {
    component.form.patchValue({ override: 0, future: true }); component.form.markAsDirty();
    await component.save();
    expect(save).toHaveBeenCalledWith('u', 'e', 0, { key: 'walk', control: { override: 0, method: 'AUTOMATIC', included: true } },
      { family: 'walking-hiking', expectedRevision: 0, policy: { method: 'AUTOMATIC', included: true } });
    expect(success).toHaveBeenCalledOnce(); expect(error).not.toHaveBeenCalled();
  });
  it('rejects invalid scores and preserves the draft after a conflict', async () => {
    component.form.patchValue({ override: -1 }); component.form.markAsDirty(); await component.save();
    expect(save).not.toHaveBeenCalled();
    component.form.patchValue({ override: 9 }); save.mockRejectedValueOnce(new Error('Changed elsewhere'));
    await component.save();
    expect(component.error()).toBe('Changed elsewhere'); expect(component.form.controls.override.value).toBe(9);
    expect(error).toHaveBeenCalledOnce(); expect(success).not.toHaveBeenCalled();
  });
  it('removes an override when the number input is cleared instead of saving zero', async () => {
    // Angular's number value accessor emits null for an empty native number input.
    component.form.controls.override.setValue(null as never); component.form.markAsDirty();
    await component.save();
    expect(save.mock.calls[0][3].control).toEqual({ method: 'AUTOMATIC', included: true });
  });
  it('copies future preferences to the current sport after an explicit reassociation', async () => {
    component.metadata.set({ version: 1, revision: 2, excluded: false, controls: { old: { activityId: 'walk' } },
      legs: { old: { activityId: null, identity: { startMs: null, endMs: null, type: 'Unknown', duration: null, distance: null },
        policy: defaultAppliedTrainingLoadPolicy(null), evaluations: null, recordedTss: null } } });
    component.form.patchValue({ future: true }); component.form.markAsDirty();
    expect(component.familyLabel).toBe('Walking & Hiking');
    await component.save();
    expect(save.mock.calls[0][4]).toMatchObject({ family: 'walking-hiking' });
  });
  it.each(['parent', 'leg'])('rejects stale %s sources even when the activity ID is unchanged', async (stalePart) => {
    const fingerprint = await browserTrainingLoadSourceFingerprint(source);
    const metadata = { version: 1, revision: 2, excluded: false, controls: {},
      parentFingerprint: stalePart === 'parent' ? 'new-parent' : fingerprint,
      legs: { walk: { activityId: 'walk', sourceFingerprint: stalePart === 'leg' ? 'new-leg' : fingerprint,
        identity: { startMs: 1000, endMs: 3601000, type: 'Walking', duration: 3600, distance: null },
        policy: defaultAppliedTrainingLoadPolicy('Walking'), evaluations: null, recordedTss: 9 } } };
    watch.mockReturnValue(of(metadata)); await component.ngOnInit();
    expect(component.model).toMatchObject({ status: 'unavailable', score: null, reasons: ['source-updating'] });
    expect(component.automatic).toBeNull();
    component.form.patchValue({ override: 1 }); component.form.markAsDirty();
    await component.save(); await component.resetLeg(); await component.associate('old', 'walk');
    expect(save).not.toHaveBeenCalled();
    watch.mockReturnValue(of({ ...metadata, excluded: true })); await component.ngOnInit();
    expect(component.model).toMatchObject({ status: 'excluded', score: 0 });
  });
  it('keeps unavailable Automatic evaluations distinct from the recorded score', () => {
    const result = { preference: 'AUTOMATIC' as const, method: null, score: null, estimated: false,
      provenance: null, reasons: ['missing-met-inputs' as const] };
    component.metadata.set({ version: 1, revision: 1, excluded: false, controls: {}, legs: {
      walk: { activityId: 'walk', identity: { startMs: 1000, endMs: 3601000, type: 'Walking', duration: 3600, distance: null },
        policy: defaultAppliedTrainingLoadPolicy('Walking'), recordedTss: 87.3,
        evaluations: { version: 1, automatic: result, hr: { ...result, preference: 'HR' }, met: { ...result, preference: 'MET' } } } } });
    expect(component.automatic).toBeNull(); expect(component.recorded).toBe(87.3);
  });
});
