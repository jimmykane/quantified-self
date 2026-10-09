import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { of, Subject, throwError } from 'rxjs';
import { TrainingLoadDialogComponent } from './training-load-dialog.component';
import { TrainingLoadService } from '../../services/training-load.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { defaultAppliedTrainingLoadPolicy } from '@shared/training-load-policy';
import { browserTrainingLoadSourceFingerprint } from '@shared/training-load-source';
import * as trainingLoadSource from '@shared/training-load-source';
import { ActivityTypes, EventImporterJSON } from '@sports-alliance/sports-lib';

describe('Training load editor', () => {
  const save = vi.fn(); const selection = vi.fn(); const success = vi.fn(); const error = vi.fn();
  const watch = vi.fn(); const watchPolicies = vi.fn();
  const source = { startDate: 1000, endDate: 3601000, stats: { 'Training Stress Score': 87.3 } };
  let component: TrainingLoadDialogComponent;
  beforeEach(async () => {
    vi.clearAllMocks(); save.mockResolvedValue(undefined);
    watch.mockReturnValue(of(null)); watchPolicies.mockReturnValue(of([])); vi.stubGlobal('crypto', webcrypto);
    TestBed.configureTestingModule({ providers: [
      { provide: MAT_DIALOG_DATA, useValue: { user: { uid: 'u' }, event: { getID: () => 'e',
        getActivities: () => [{ getID: () => 'walk', type: 'Walking', toJSON: () => source, getStat: () => ({ getValue: () => 87.3 }) }],
        toJSON: () => source, getStat: () => ({ getValue: () => 87.3 }) } } },
      { provide: MatDialogRef, useValue: { close: vi.fn() } },
      { provide: TrainingLoadService, useValue: { save, watch, watchPolicies } },
      { provide: AppHapticsService, useValue: { selection, success, error } },
    ] });
    component = TestBed.runInInjectionContext(() => new TrainingLoadDialogComponent());
    await component.ngOnInit();
  });
  afterEach(() => vi.unstubAllGlobals());
  it('explains pending imports without displaying previous candidates as current', () => {
    component.metadata.set({ version: 1, revision: 1, excluded: false, controls: {}, sourceWritePending: true });
    expect(component.model).toMatchObject({ score: null, reasons: ['source-updating'] });
    expect(component.automatic).toBeNull();
    expect(component.explanation).toContain('Retry the import if it failed');
    component.metadata.update(value => ({ ...value!, excluded: true }));
    expect(component.model).toMatchObject({ score: 0, status: 'excluded' });
    expect(component.explanation).toContain('Excluded from modeled load');
  });
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
  it.each(['metadata', 'policies'])('stops using stale editor state when %s cannot reload after a successful save', async failedRead => {
    (failedRead === 'metadata' ? watch : watchPolicies).mockReturnValue(throwError(() => new Error('Offline')));
    component.form.patchValue({ override: 0 }); component.form.markAsDirty();
    await component.save();
    expect(save).toHaveBeenCalledOnce();
    expect(component.loaded()).toBe(false); expect(component.busy()).toBe(false);
    expect(component.error()).toMatch(/saved.*could not be loaded/i);
    expect(error).toHaveBeenCalledOnce(); expect(success).not.toHaveBeenCalled();
    await component.save(); await component.resetLeg(); await component.resetWorkout();
    await component.excludeWorkout(true); await component.associate('old', 'walk'); await component.dismiss('old');
    expect(save).toHaveBeenCalledOnce();
  });
  it.each(['metadata', 'policies'])('releases the other waiting read when the %s refresh fails', async failedRead => {
    const waiting$ = new Subject();
    (failedRead === 'metadata' ? watch : watchPolicies).mockReturnValue(throwError(() => new Error('Offline')));
    (failedRead === 'metadata' ? watchPolicies : watch).mockReturnValue(waiting$);
    component.form.patchValue({ override: 0 }); component.form.markAsDirty();
    try {
      await component.save();
      expect(waiting$.observed).toBe(false);
      expect(component.loaded()).toBe(false);
    } finally { waiting$.complete(); }
  });
  it.each(['initial', 'after-save'])('releases pending %s reads when the editor is destroyed', async phase => {
    const metadata$ = new Subject<null>(); const policies$ = new Subject<[]>();
    watch.mockReturnValue(metadata$); watchPolicies.mockReturnValue(policies$);
    component.form.patchValue({ override: 9 }); component.form.markAsDirty();
    const pending = phase === 'initial' ? component.ngOnInit() : component.save();
    try {
      await vi.waitFor(() => {
        expect(metadata$.observed).toBe(true); expect(policies$.observed).toBe(true);
      });
      TestBed.resetTestingModule();
      expect(metadata$.observed).toBe(false); expect(policies$.observed).toBe(false);
      await pending;
      expect(component.loaded()).toBe(false); expect(component.error()).toBe('');
      expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    } finally {
      metadata$.next(null); metadata$.complete(); policies$.next([]); policies$.complete(); await pending;
    }
  });
  it.each(['resolve', 'reject'] as const)('keeps a closed editor silent when a pending save later %ss', async outcome => {
    let finish!: () => void;
    save.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finish = outcome === 'resolve' ? resolve : () => reject(new Error('Late failure'));
    }));
    component.form.patchValue({ override: 9 }); component.form.markAsDirty();
    const pending = component.save();
    TestBed.resetTestingModule(); finish(); await pending;
    expect(watch).toHaveBeenCalledOnce(); expect(watchPolicies).toHaveBeenCalledOnce();
    expect(component.form.controls.override.value).toBe(9); expect(component.error()).toBe('');
    expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('discards source verification that finishes after the editor is destroyed', async () => {
    let finish!: (fingerprint: string) => void;
    const fingerprint = vi.spyOn(trainingLoadSource, 'browserTrainingLoadSourceFingerprint')
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    watch.mockReturnValue(of({ version: 1, revision: 2, excluded: false, controls: {}, parentFingerprint: 'current' }));
    const pending = component.ngOnInit();
    try {
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      TestBed.resetTestingModule(); finish('current'); await pending;
      expect(component.loaded()).toBe(false); expect(component.metadata()).toBeNull();
      expect(component.error()).toBe(''); expect(error).not.toHaveBeenCalled();
    } finally { fingerprint.mockRestore(); finish?.('current'); await pending; }
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
  it('blocks leg edits when a saved active leg is missing from the opened workout', async () => {
    const fingerprint = await browserTrainingLoadSourceFingerprint(source);
    const leg = { activityId: 'walk', sourceFingerprint: fingerprint,
      identity: { startMs: 1000, endMs: 3601000, type: 'Walking', duration: 3600, distance: null },
      policy: defaultAppliedTrainingLoadPolicy('Walking'), evaluations: null, recordedTss: 9 };
    watch.mockReturnValue(of({ version: 1, revision: 2, excluded: false, controls: {}, parentFingerprint: fingerprint,
      legs: { walk: leg, missing: { ...leg, activityId: 'missing' } } }));
    await component.ngOnInit();
    expect(component.sourceCurrent()).toBe(false);
    expect(component.model).toMatchObject({ score: null, reasons: ['source-updating'] });
    component.form.patchValue({ override: 0 }); component.form.markAsDirty(); await component.save();
    expect(save).not.toHaveBeenCalled();
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
  it('accepts restored power-curve zeros as the same saved leg and allows its override', async () => {
    const parent = { name: 'Ride', startDate: 1000, endDate: 3601000, stats: { 'Training Stress Score': 9 } };
    const leg = { startDate: 1000, endDate: 3601000, type: ActivityTypes.Cycling,
      creator: { name: 'Test' }, laps: [], intensityZones: [], streams: [],
      stats: { 'Training Stress Score': 9, PowerCurve: [{ duration: 1, power: 0, wattsPerKg: 0 }] } };
    const event = EventImporterJSON.getEventFromJSON({ ...parent, activities: [leg] } as any).setID('e');
    event.getActivities()[0].setID('ride');
    TestBed.inject(MAT_DIALOG_DATA).event = event;
    watch.mockReturnValue(of({ version: 1, revision: 1, excluded: false, controls: {},
      parentFingerprint: await browserTrainingLoadSourceFingerprint(parent),
      legs: { ride: { activityId: 'ride', sourceFingerprint: await browserTrainingLoadSourceFingerprint(leg),
        identity: { startMs: 1000, endMs: 3601000, type: ActivityTypes.Cycling, duration: 3600, distance: null },
        policy: defaultAppliedTrainingLoadPolicy(ActivityTypes.Cycling), evaluations: null, recordedTss: 9 } } }));
    component = TestBed.runInInjectionContext(() => new TrainingLoadDialogComponent());
    await component.ngOnInit();
    expect(component.sourceCurrent()).toBe(true);
    expect(component.model).toMatchObject({ status: 'available', score: 9 });
    component.form.patchValue({ override: 0 }); component.form.markAsDirty(); await component.save();
    expect(save).toHaveBeenCalledWith('u', 'e', 1,
      { key: 'ride', control: { method: 'AUTOMATIC', included: true, override: 0 } }, undefined);
  });
});
