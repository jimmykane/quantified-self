import { TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';
import { DataFeeling, DataRPE, DistanceUnits } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedModule } from '../../../modules/shared.module';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';
import { WorkoutReflectionService } from '../../../services/workout-reflection.service';
import { EventDetailsSummaryBottomSheetComponent } from './event-details-summary-bottom-sheet.component';

describe('Combined event details and post-workout feedback', () => {
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const service = { read: vi.fn(), hasExactWorkoutLink: vi.fn(), saveEventDetails: vi.fn() };
  const browser = { createRandomUUID: vi.fn() };
  const ref = { dismiss: vi.fn(), disableClose: false };
  const snackBar = { open: vi.fn() };
  const auth$ = new Subject<{ uid: string }>();
  const getStat = vi.fn();
  const addStat = vi.fn();
  let component: EventDetailsSummaryBottomSheetComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<EventDetailsSummaryBottomSheetComponent>>;
  const saved = { schemaVersion: 1 as const, revision: 4, deleted: false,
    mutationId: '11111111-1111-4111-8111-111111111111', note: 'private note' };
  async function create() {
    fixture = TestBed.createComponent(EventDetailsSummaryBottomSheetComponent);
    component = fixture.componentInstance; fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  }
  beforeEach(async () => {
    vi.clearAllMocks(); ref.disableClose = false;
    getStat.mockReturnValue(null);
    browser.createRandomUUID.mockReturnValue('11111111-1111-4111-8111-111111111111');
    service.read.mockResolvedValue(null); service.hasExactWorkoutLink.mockResolvedValue(false); service.saveEventDetails.mockResolvedValue(null);
    TestBed.configureTestingModule({ declarations: [EventDetailsSummaryBottomSheetComponent], imports: [SharedModule, NoopAnimationsModule], providers: [
      { provide: MAT_BOTTOM_SHEET_DATA, useValue: { user: { uid: 'owner', settings: { unitSettings: { distanceUnits: [DistanceUnits.Miles] } } },
        event: { name: 'Run', description: 'Original', getID: () => 'event', getStat, addStat, getActivities: () => [
          { getID: () => 'run', type: 'Running' }, { getID: () => 'bike', type: 'Cycling' } ] } } },
      { provide: MatBottomSheetRef, useValue: ref }, { provide: MatSnackBar, useValue: snackBar },
      { provide: AppHapticsService, useValue: haptics }, { provide: WorkoutReflectionService, useValue: service },
      { provide: AppAuthService, useValue: { user$: auth$ } }, { provide: BrowserCompatibilityService, useValue: browser },
    ] });
    await create();
  });
  it('hydrates one form silently and has exactly one RPE selector and one Save action', async () => {
    expect(fixture.nativeElement.querySelectorAll('mat-select')).toHaveLength(3);
    expect(fixture.nativeElement.querySelectorAll('button[mat-flat-button]')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Post-workout feedback');
    expect(fixture.nativeElement.textContent).not.toContain('Saved workout RPE');
    expect(component.canSave()).toBe(false); await component.save();
    expect(haptics.selection).not.toHaveBeenCalled(); expect(service.saveEventDetails).not.toHaveBeenCalled();
  });
  it('stages name, description, Feeling, RPE and private note, then saves everything once', async () => {
    component.name.set('Updated'); component.description.set('Description');
    component.setRating('feeling', 4); component.setRating('rpe', 0); component.note.set('windy');
    expect(component.data.event.name).toBe('Run'); expect(addStat).not.toHaveBeenCalled();
    expect(service.saveEventDetails).not.toHaveBeenCalled();
    await component.save();
    expect(service.saveEventDetails).toHaveBeenCalledWith(expect.objectContaining({ target: 'recording' }), {
      name: { before: 'Run', after: 'Updated' }, description: { before: 'Original', after: 'Description' },
      feeling: { before: null, after: 4 }, rpe: { before: null, after: 0 },
    }, expect.objectContaining({ expectedRevision: 0, fields: { note: 'windy' }, deleted: false }));
    expect(component.data.event.name).toBe('Updated'); expect(addStat).toHaveBeenCalledWith(expect.any(DataRPE));
    expect(haptics.selection).toHaveBeenCalledTimes(3); expect(haptics.success).toHaveBeenCalledOnce();
    expect(ref.dismiss).toHaveBeenCalledWith(true);
  });
  it('reads and saves feedback for the workout without a redundant selector when it has one activity', async () => {
    fixture.destroy(); service.read.mockClear();
    TestBed.inject(MAT_BOTTOM_SHEET_DATA).event.getActivities = () => [{ getID: () => 'run', type: 'Running' }];
    await create();
    expect(fixture.nativeElement.querySelectorAll('mat-select')).toHaveLength(2);
    expect(fixture.nativeElement.textContent).not.toContain('Reflect on');
    expect(service.read).toHaveBeenCalledWith(expect.objectContaining({ target: 'recording', activityId: 'recording' }));
    component.note.set('Workout feedback'); await component.save();
    expect(service.saveEventDetails).toHaveBeenCalledWith(expect.objectContaining({ target: 'recording', activityId: 'recording' }), {},
      expect.objectContaining({ fields: { note: 'Workout feedback' } }));
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('Cancel discards every staged field without mutating the recording', () => {
    component.name.set('Draft'); component.setRating('rpe', 7); component.note.set('private draft'); component.close();
    expect(component.data.event.name).toBe('Run'); expect(addStat).not.toHaveBeenCalled();
    expect(service.saveEventDetails).not.toHaveBeenCalled(); expect(ref.dismiss).toHaveBeenCalled();
  });
  it('a details-only edit omits the reflection and needs no UUID', async () => {
    component.description.set('new description'); await component.save();
    expect(service.saveEventDetails).toHaveBeenCalledWith(expect.any(Object), { description: { before: 'Original', after: 'new description' } }, undefined);
    expect(browser.createRandomUUID).not.toHaveBeenCalled();
  });
  it('a note-only edit does not change Feeling or workout RPE', async () => {
    component.note.set('private context'); await component.save();
    expect(service.saveEventDetails).toHaveBeenCalledWith(expect.any(Object), {}, expect.objectContaining({ fields: { note: 'private context' } }));
    expect(addStat).not.toHaveBeenCalled();
  });
  it.each([0, 0.5, 2.5, 10])('preserves imported RPE %s without silently rounding or saving it', async value => {
    fixture.destroy(); getStat.mockImplementation(type => type === DataRPE.type ? new DataRPE(value) : new DataFeeling(3));
    await create();
    expect(component.rpe()).toBe(value); expect(component.rpeOptions.some(option => option.value === value)).toBe(true);
    expect(component.canSave()).toBe(false); expect(haptics.selection).not.toHaveBeenCalled();
    component.note.set('note'); await component.save();
    expect(service.saveEventDetails.mock.calls[0][1]).toEqual({}); expect(addStat).not.toHaveBeenCalled();
  });
  it('hydrates a saved note and preserves event edits when changing its target', async () => {
    fixture.destroy(); service.read.mockResolvedValueOnce(saved); await create();
    expect(component.note()).toBe('private note'); expect(component.canSave()).toBe(false);
    component.name.set('Draft'); component.setRating('rpe', 5); component.note.set('unsaved');
    await component.select('activity_bike');
    expect(component.note()).toBe(''); expect(component.name()).toBe('Draft'); expect(component.rpe()).toBe(5);
    component.note.set('wind'); await component.save();
    expect(service.saveEventDetails).toHaveBeenCalledWith(expect.objectContaining({ target: 'activity', activityId: 'bike' }),
      expect.objectContaining({ rpe: { before: null, after: 5 } }), expect.objectContaining({ fields: { note: 'wind' } }));
  });
  it('keeps the full failed draft and reuses a UUID for an unchanged uncertain retry', async () => {
    service.saveEventDetails.mockRejectedValueOnce(new Error('offline'));
    component.name.set('new name'); component.setRating('rpe', 5); component.note.set('tired');
    await component.save(); expect(component.data.event.name).toBe('Run'); expect(addStat).not.toHaveBeenCalled();
    expect(component.note()).toBe('tired'); expect(component.rpe()).toBe(5); expect(ref.dismiss).not.toHaveBeenCalled();
    await component.save();
    expect(service.saveEventDetails.mock.calls[0][2].mutationId).toBe(service.saveEventDetails.mock.calls[1][2].mutationId);
    expect(browser.createRandomUUID).toHaveBeenCalledOnce(); expect(haptics.error).toHaveBeenCalledOnce();
  });
  it('does not write any field if a required UUID is unavailable', async () => {
    browser.createRandomUUID.mockReturnValueOnce(null);
    component.name.set('draft'); component.note.set('tired'); await component.save();
    expect(component.error()).toContain('supported browser'); expect(component.busy()).toBe(false);
    expect(service.saveEventDetails).not.toHaveBeenCalled(); expect(component.data.event.name).toBe('Run');
  });
  it('stages permanent reflection deletion for the same Save changes action and allows cancelling it', async () => {
    fixture.destroy(); service.read.mockResolvedValue(saved); await create();
    component.reviewDelete(); expect(service.saveEventDetails).not.toHaveBeenCalled();
    component.cancelDelete(); expect(component.hasChanges()).toBe(false);
    component.reviewDelete(); component.name.set('Edited'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Saving will permanently delete');
    await component.save();
    expect(service.saveEventDetails).toHaveBeenCalledWith(expect.any(Object), { name: { before: 'Run', after: 'Edited' } },
      expect.objectContaining({ expectedRevision: 4, deleted: true }));
  });
  it('requires deliberate deletion rather than saving a blank replacement', async () => {
    fixture.destroy(); service.read.mockResolvedValue(saved); await create();
    component.note.set('  '); component.name.set('Edited'); await component.save();
    expect(component.canSave()).toBe(false); expect(service.saveEventDetails).not.toHaveBeenCalled();
  });
  it('never uses revision zero after a failed reflection read, while allowing details-only edits', async () => {
    service.read.mockRejectedValueOnce(new Error('offline')); await component.load();
    component.note.set('draft'); component.name.set('Edited'); await component.save();
    expect(service.saveEventDetails).not.toHaveBeenCalled();
    component.note.set(''); await component.save();
    expect(service.saveEventDetails).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), undefined);
  });
  it('allows details-only saving while the optional reflection is still loading', async () => {
    service.read.mockImplementationOnce(() => new Promise(() => undefined));
    void component.load(); component.setRating('rpe', 5);
    expect(component.loading()).toBe(true); expect(component.canSave()).toBe(true);
    await component.save();
    expect(service.saveEventDetails).toHaveBeenCalledWith(expect.any(Object), { rpe: { before: null, after: 5 } }, undefined);
  });
  it('ignores delayed saves and clears private text on account change', async () => {
    let fail!: (error: Error) => void;
    service.saveEventDetails.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    component.name.set('draft'); component.note.set('private draft'); const pending = component.save();
    auth$.next({ uid: 'other' }); fail(new Error('old conflict')); await pending;
    expect(component.error()).toBe(''); expect(component.note()).toBe(''); expect(component.data.event.name).toBe('Run');
    expect(haptics.success).not.toHaveBeenCalled(); expect(haptics.error).not.toHaveBeenCalled();
  });
  it('ignores a delayed prior-target read after a new selection', async () => {
    let finish!: (value: typeof saved) => void;
    service.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = component.load(); await component.select('activity_bike'); finish(saved); await pending;
    expect(component.selected().id).toBe('activity_bike'); expect(component.note()).toBe('');
  });
  it('locks controls and dismissal during a save, with feedback only after completion', async () => {
    let finish!: () => void;
    service.saveEventDetails.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    component.note.set('draft'); const pending = component.save(); fixture.detectChanges();
    expect(ref.disableClose).toBe(true); expect(component.canSave()).toBe(false);
    component.close(); component.setRating('rpe', 8); await component.select('activity_bike');
    expect(ref.dismiss).not.toHaveBeenCalled(); expect(component.rpe()).toBeNull();
    expect(haptics.success).not.toHaveBeenCalled(); finish(); await pending; expect(haptics.success).toHaveBeenCalledOnce();
  });
  it('does not read or expose reflections for benchmark events', async () => {
    fixture.destroy(); Object.assign(TestBed.inject(MAT_BOTTOM_SHEET_DATA).event, { mergeType: 'benchmark' });
    service.read.mockClear(); await create();
    expect(service.read).not.toHaveBeenCalled(); expect(fixture.nativeElement.textContent).not.toContain('Private reflection');
    component.name.set('Benchmark'); await component.save();
    expect(service.saveEventDetails).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), undefined);
  });
  it('unchanged rating/target actions and typing are silent', async () => {
    component.name.set('typing'); component.note.set('typing'); await component.select('recording');
    component.setRating('rpe', component.rpe()); expect(haptics.selection).not.toHaveBeenCalled();
  });
});
