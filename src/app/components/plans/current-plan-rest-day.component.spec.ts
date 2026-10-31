import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { TrainingPlanV1 } from '@shared/training-plans';
import { CurrentPlanRestDayComponent } from './current-plan-rest-day.component';
import { AppUserService } from '../../services/app.user.service';
import { TrainingPlansService } from '../../services/training-plans.service';
import { AppHapticsService } from '../../services/app.haptics.service';

describe('Current plan rest day', () => {
  it('shows standalone calendar rest without a plan and opens its exact Calendar day', () => {
    const user = signal({ uid: 'owner' }), source = new Subject<import('@shared/training-rest-days').TrainingRestDayV1 | null>();
    const router = { navigate: vi.fn() }, haptics = { selection: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: AppUserService, useValue: { user } },
      { provide: TrainingPlansService, useValue: { watchActivePlan: () => of(null), watchCalendarRestDay: () => source } },
      { provide: Router, useValue: router }, { provide: AppHapticsService, useValue: haptics }] });
    const fixture = TestBed.createComponent(CurrentPlanRestDayComponent);
    fixture.componentRef.setInput('ownerUid', 'owner'); fixture.componentRef.setInput('localDate', '2026-10-30'); fixture.detectChanges();
    source.next({ schemaVersion: 1, localDate: '2026-10-30', isRestDay: true, revision: 1 }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Rest day · Calendar'); expect(haptics.selection).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button').click(); expect(router.navigate).toHaveBeenCalledWith(['/calendar/day', '2026-10-30']);
    expect(haptics.selection).toHaveBeenCalledOnce();
    source.next({ schemaVersion: 1, localDate: '2026-10-30', isRestDay: false, revision: 2 }); fixture.detectChanges();
    expect(fixture.componentInstance.isRestDay()).toBe(false); fixture.destroy(); expect(source.observed).toBe(false);
  });
  it('is owner-only, shares one plan read across date changes and never changes a Training metric', () => {
    const user = signal({ uid: 'owner' });
    const source = new Subject<TrainingPlanV1 | null>();
    const plans = { watchCalendarRestDay: vi.fn(() => of(null)), watchActivePlan: vi.fn(() => source) };
    const router = { navigate: vi.fn() }, haptics = { selection: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: AppUserService, useValue: { user } },
      { provide: TrainingPlansService, useValue: plans }, { provide: Router, useValue: router }, { provide: AppHapticsService, useValue: haptics }] });
    const fixture = TestBed.createComponent(CurrentPlanRestDayComponent);
    fixture.componentRef.setInput('ownerUid', 'other'); fixture.componentRef.setInput('localDate', '2026-10-30'); fixture.detectChanges();
    expect(plans.watchActivePlan).not.toHaveBeenCalled();
    fixture.componentRef.setInput('ownerUid', 'owner'); fixture.detectChanges();
    const plan: TrainingPlanV1 = { schemaVersion: 1, id: 'plan', name: 'Autumn', lifecycle: 'active', startLocalDate: '2026-10-01',
      endLocalDate: '2026-10-31', restDays: ['2026-10-30'], revision: 1, lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 1 };
    source.next(plan); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Rest day · Autumn');
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button').click();
    expect(router.navigate).toHaveBeenCalledExactlyOnceWith(['/training/plans/plan', 'plan'], { queryParams: { date: '2026-10-30' } });
    expect(haptics.selection).toHaveBeenCalledOnce();
    source.next(null); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(fixture.componentInstance.isRestDay()).toBe(false);
    source.next({ ...plan, id: 'replacement', name: 'Winter' }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Rest day · Winter');
    expect(fixture.componentInstance.isRestDay()).toBe(true);
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('localDate', '2026-10-31'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(plans.watchActivePlan).toHaveBeenCalledOnce();
    user.set({ uid: 'another' }); source.next(plan); fixture.detectChanges();
    expect(fixture.componentInstance.isRestDay()).toBe(false);
    fixture.destroy(); expect(source.observed).toBe(false);
  });
});
