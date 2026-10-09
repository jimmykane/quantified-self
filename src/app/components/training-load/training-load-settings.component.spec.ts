import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { TrainingLoadSettingsComponent } from './training-load-settings.component';
import { TrainingLoadService, type TrainingLoadPolicyHead } from '../../services/training-load.service';
import { AppHapticsService } from '../../services/app.haptics.service';

describe('dated Training load settings', () => {
  const savePolicy = vi.fn(); const success = vi.fn(); const error = vi.fn();
  let component: TrainingLoadSettingsComponent;
  let policies$: BehaviorSubject<TrainingLoadPolicyHead[]>;
  beforeEach(() => {
    vi.clearAllMocks(); savePolicy.mockResolvedValue(undefined);
    policies$ = new BehaviorSubject<TrainingLoadPolicyHead[]>([
      { id: 'walking-hiking', revision: 4, method: 'HR', included: false },
    ]);
    TestBed.configureTestingModule({ providers: [
      { provide: TrainingLoadService, useValue: { savePolicy, watchPolicies: () => policies$ } },
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
  it('shows a newer policy received during a successful save and uses its revision for the next edit', async () => {
    let finish!: () => void;
    savePolicy.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const row = component.rows.find(row => row.id === 'walking-hiking')!;
    row.form.patchValue({ included: true }); row.form.markAsDirty();
    const pending = component.save(row);
    policies$.next([{ id: row.id, revision: 5, method: 'HR', included: true }]);
    policies$.next([{ id: row.id, revision: 6, method: 'MET', included: false }]);
    finish(); await pending;
    expect(row.revision).toBe(6);
    expect(row.form.getRawValue()).toEqual({ method: 'MET', included: false });
    expect(row.form.pristine).toBe(true);
    row.form.patchValue({ included: true }); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', row.id, 6, { method: 'MET', included: true });
  });
  it.each(['resolve', 'reject'] as const)('ignores an old account save that later %ss while the new account saves', async outcome => {
    let finish!: () => void;
    savePolicy.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finish = outcome === 'resolve' ? resolve : () => reject(new Error('Old account failure'));
    }));
    const row = component.rows.find(row => row.id === 'walking-hiking')!;
    row.form.patchValue({ included: true }); row.form.markAsDirty();
    const oldSave = component.save(row);
    policies$ = new BehaviorSubject<TrainingLoadPolicyHead[]>([
      { id: row.id, revision: 9, method: 'MET', included: false },
    ]);
    component.uid = 'next-owner'; component.ngOnChanges();
    expect(row.form.enabled).toBe(true); expect(component.busy()).toBeNull();
    let finishNew!: () => void;
    savePolicy.mockImplementationOnce(() => new Promise<void>(resolve => { finishNew = resolve; }));
    row.form.patchValue({ included: true }); row.form.markAsDirty();
    const newSave = component.save(row);
    finish(); await oldSave;
    expect(row.revision).toBe(9); expect(row.form.dirty).toBe(true); expect(row.form.disabled).toBe(true);
    expect(component.busy()).toBe(row.id); expect(component.message()).toBe('');
    expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    finishNew(); await newSave;
    expect(savePolicy).toHaveBeenLastCalledWith('next-owner', row.id, 9, { method: 'MET', included: true });
    expect(row.revision).toBe(10); expect(component.busy()).toBeNull(); expect(success).toHaveBeenCalledOnce();
  });
  it.each(['resolve', 'reject'] as const)('keeps a destroyed editor silent when its save later %ss', async outcome => {
    let finish!: () => void;
    savePolicy.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finish = outcome === 'resolve' ? resolve : () => reject(new Error('Late failure'));
    }));
    const row = component.rows.find(row => row.id === 'walking-hiking')!;
    row.form.patchValue({ included: true }); row.form.markAsDirty();
    const pending = component.save(row);
    component.ngOnDestroy(); expect(policies$.observed).toBe(false);
    finish(); await pending;
    expect(success).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(component.message()).toBe(''); expect(row.revision).toBe(4);
  });
});
