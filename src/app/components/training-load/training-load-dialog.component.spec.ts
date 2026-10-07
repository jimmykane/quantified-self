import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { TrainingLoadDialogComponent } from './training-load-dialog.component';
import { TrainingLoadService } from '../../services/training-load.service';
import { AppHapticsService } from '../../services/app.haptics.service';

describe('Training load editor', () => {
  const save = vi.fn(); const selection = vi.fn(); const success = vi.fn(); const error = vi.fn();
  let component: TrainingLoadDialogComponent;
  beforeEach(async () => {
    vi.clearAllMocks(); save.mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [
      { provide: MAT_DIALOG_DATA, useValue: { user: { uid: 'u' }, event: { getID: () => 'e',
        getActivities: () => [{ getID: () => 'walk', type: 'Walking', getStat: () => ({ getValue: () => 87.3 }) }],
        getStat: () => ({ getValue: () => 87.3 }) } } },
      { provide: MatDialogRef, useValue: { close: vi.fn() } },
      { provide: TrainingLoadService, useValue: { save, watch: () => of(null), watchPolicies: () => of([]) } },
      { provide: AppHapticsService, useValue: { selection, success, error } },
    ] });
    component = TestBed.runInInjectionContext(() => new TrainingLoadDialogComponent());
    await component.ngOnInit();
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
});
