import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
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
    expect(row.form.getRawValue()).toEqual({ method: 'HR', included: false, cssPace: '' });
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
    expect(row.form.getRawValue()).toEqual({ method: 'MET', included: false, cssPace: '' });
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


describe('CSS input and units', () => {
  it.each([
    ['1:53', 113, '02:04', '01:53'],
    ['1:54', 114, '02:05', '01:54'],
  ] as const)('preserves CSS entered as %s per 100 yards through saving and reopening', async (input, seconds, metricLabel, yardLabel) => {
    const policies$ = new BehaviorSubject<TrainingLoadPolicyHead[]>([]);
    const savePolicy = vi.fn().mockImplementation(async (_uid, id, revision, policy) => {
      policies$.next([{ ...policy, id, revision: revision + 1 }]);
    });
    const selection = vi.fn();
    TestBed.configureTestingModule({ providers: [
      { provide: TrainingLoadService, useValue: { savePolicy, watchPolicies: () => policies$ } },
      { provide: AppHapticsService, useValue: { success: vi.fn(), error: vi.fn(), selection } },
    ] });
    const open = () => {
      const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
      fixture.componentRef.setInput('uid', 'owner'); fixture.detectChanges();
      return fixture;
    };
    const fixture = open();
    const row = fixture.componentInstance.rows.find(row => row.id === 'swimming')!;
    const swimming = fixture.debugElement.query(By.css('section[aria-label="Swimming"]'));
    const unit = swimming.queryAll(By.directive(MatSelect))[1].componentInstance as MatSelect;
    expect(selection).not.toHaveBeenCalled();
    unit.selectionChange.emit({ source: unit, value: 'yd' }); fixture.detectChanges();
    expect(swimming.nativeElement.textContent).toContain('mm:ss per 100 yd');
    const pace = swimming.query(By.css('input')).nativeElement as HTMLInputElement;
    pace.value = input; pace.dispatchEvent(new Event('input'));
    expect(row.form.dirty).toBe(true);
    await fixture.componentInstance.save(row);
    // 100 yards is exactly 91.44 metres. The same time in metres would be a different CSS.
    const speed = 91.44 / seconds;
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'swimming', 0,
      { method: 'AUTOMATIC', included: true, swimThresholdSpeed: speed });
    expect(selection).toHaveBeenCalledOnce();
    fixture.destroy();

    const reopened = open();
    const saved = reopened.componentInstance.rows.find(row => row.id === 'swimming')!;
    expect(saved.form.controls.cssPace.value).toBe(metricLabel);
    for (let i = 0; i < 10; i++) {
      reopened.componentInstance.changeCssUnit(saved, 'yd');
      expect(saved.form.controls.cssPace.value).toBe(yardLabel);
      reopened.componentInstance.changeCssUnit(saved, 'm');
      expect(saved.form.controls.cssPace.value).toBe(metricLabel);
    }
    expect(saved.form.pristine).toBe(true);
    saved.form.controls.included.setValue(false); saved.form.markAsDirty();
    await reopened.componentInstance.save(saved);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'swimming', 1,
      { method: 'AUTOMATIC', included: false, swimThresholdSpeed: speed });
    reopened.destroy();
  });
  it('renders CSS inputs and the pace choice only in the Swimming family', () => {
    TestBed.configureTestingModule({ providers: [
      { provide: TrainingLoadService, useValue: { watchPolicies: () => new BehaviorSubject([]), savePolicy: vi.fn() } },
      { provide: AppHapticsService, useValue: { success: vi.fn(), error: vi.fn(), selection: vi.fn() } },
    ] });
    const fixture = TestBed.createComponent(TrainingLoadSettingsComponent);
    fixture.componentRef.setInput('uid', 'owner'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('input[formControlName="cssPace"]').length).toBe(1);
    const swimming = fixture.nativeElement.querySelector('section[aria-label="Swimming"]');
    expect(swimming.textContent).toContain('Critical swim speed');
    const choices = fixture.debugElement.queryAll(By.directive(MatSelect))
      .flatMap(element => (element.componentInstance as MatSelect).options.toArray().map(option => option.value));
    expect(choices.filter(value => value === 'SWIM_PACE')).toHaveLength(1);
    fixture.destroy();
  });
  it('saves CSS canonically, converts yards without drift, and allows removal only for future swims', async () => {
    const savePolicy = vi.fn().mockResolvedValue(undefined);
    const policies$ = new BehaviorSubject<TrainingLoadPolicyHead[]>([]);
    TestBed.configureTestingModule({ providers: [
      { provide: TrainingLoadService, useValue: { savePolicy, watchPolicies: () => policies$ } },
      { provide: AppHapticsService, useValue: { success: vi.fn(), error: vi.fn(), selection: vi.fn() } },
    ] });
    const component = TestBed.runInInjectionContext(() => new TrainingLoadSettingsComponent());
    component.uid = 'owner'; component.ngOnChanges();
    const row = component.rows.find(row => row.id === 'swimming')!;
    for (const text of ['0:00', '1:60', 'garbage', '-1:00']) {
      row.form.controls.cssPace.setValue(text); row.form.markAsDirty();
      expect(component.validCss(row)).toBe(false); await component.save(row);
    }
    expect(savePolicy).not.toHaveBeenCalled();
    row.form.patchValue({ method: 'SWIM_PACE', cssPace: '1:53' });
    component.changeCssUnit(row, 'yd'); expect(row.form.controls.cssPace.value).toBe('01:43');
    component.changeCssUnit(row, 'm'); expect(row.form.controls.cssPace.value).toBe('01:53');
    await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'swimming', 0,
      { method: 'SWIM_PACE', included: true, swimThresholdSpeed: 100 / 113 });
    // Changing another preference must not quantize the saved speed to displayed seconds.
    policies$.next([{ id: 'swimming', revision: 2, method: 'AUTOMATIC', included: true, swimThresholdSpeed: 0.888888 }]);
    row.form.patchValue({ included: false }); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'swimming', 2,
      { method: 'AUTOMATIC', included: false, swimThresholdSpeed: 0.888888 });
    row.form.controls.cssPace.setValue(''); row.form.markAsDirty(); await component.save(row);
    expect(savePolicy).toHaveBeenLastCalledWith('owner', 'swimming', 3, { method: 'AUTOMATIC', included: false });
    component.ngOnDestroy();
  });
});
