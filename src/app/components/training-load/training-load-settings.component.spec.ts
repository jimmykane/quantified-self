import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { TrainingLoadSettingsComponent } from './training-load-settings.component';
import { TrainingLoadService } from '../../services/training-load.service';
import { AppHapticsService } from '../../services/app.haptics.service';

describe('dated Training load settings', () => {
  const savePolicy = vi.fn(); const success = vi.fn(); const error = vi.fn();
  let component: TrainingLoadSettingsComponent;
  beforeEach(() => {
    vi.clearAllMocks(); savePolicy.mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [
      { provide: TrainingLoadService, useValue: { savePolicy, watchPolicies: () => of([
        { id: 'walking-hiking', revision: 4, method: 'HR', included: false },
      ]) } },
      { provide: AppHapticsService, useValue: { success, error, selection: vi.fn() } },
    ] });
    component = TestBed.runInInjectionContext(() => new TrainingLoadSettingsComponent());
    component.uid = 'owner'; component.ngOnChanges();
  });
  it('loads existing defaults quietly and saves only a changed family with its revision', async () => {
    const row = component.rows.find(row => row.id === 'walking-hiking')!;
    expect(row.form.getRawValue()).toEqual({ method: 'HR', included: false });
    await component.save(row); expect(savePolicy).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
    row.form.patchValue({ included: true }); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy).toHaveBeenCalledWith('owner', 'walking-hiking', 4, { method: 'HR', included: true });
    expect(row.revision).toBe(5); expect(row.form.pristine).toBe(true); expect(success).toHaveBeenCalledOnce();
  });
  it('retains a conflicting draft for review without claiming that it saved', async () => {
    const row = component.rows[0]; row.form.patchValue({ method: 'MET' }); row.form.markAsDirty();
    savePolicy.mockRejectedValueOnce(new Error('Preferences changed elsewhere.'));
    await component.save(row);
    expect(row.form.dirty).toBe(true); expect(row.form.controls.method.value).toBe('MET');
    expect(component.message()).toContain('changed elsewhere'); expect(error).toHaveBeenCalledOnce(); expect(success).not.toHaveBeenCalled();
  });
});
