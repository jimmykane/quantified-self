import { TestBed } from '@angular/core/testing';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from '@shared/training-plans';
import { AppHapticsService } from '../../services/app.haptics.service';
import { PlanScheduleCalendarComponent } from './plan-schedule-calendar.component';

describe('PlanScheduleCalendarComponent', () => {
  const plan: TrainingPlanV1 = {
    schemaVersion: 1, id: 'plan', name: 'Build', lifecycle: 'paused', startLocalDate: '2026-09-09', endLocalDate: '2026-10-06',
    revision: 1, lastCheckpointRevision: 1, workoutCount: 1, createdAtMs: 1, updatedAtMs: 1,
  };
  const workout: ScheduledWorkoutV1 = {
    schemaVersion: 1, id: 'workout', title: 'A long workout title '.repeat(6), localDate: '2026-09-12', planId: 'plan', lifecycle: 'skipped',
    structure: { version: 1, sport: ActivityTypes.Running, nodes: [] }, revision: 1, createdAtMs: 1, updatedAtMs: 1,
  };
  let selection: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    selection = vi.fn();
    await TestBed.configureTestingModule({
      imports: [PlanScheduleCalendarComponent],
      providers: [{ provide: AppHapticsService, useValue: { selection } }],
    }).compileComponents();
  });

  async function render() {
    const fixture = TestBed.createComponent(PlanScheduleCalendarComponent);
    fixture.componentRef.setInput('plan', plan);
    fixture.componentRef.setInput('workouts', [workout]);
    fixture.componentRef.setInput('selectedDate', '2026-09-09');
    fixture.componentRef.setInput('today', '2026-09-09');
    fixture.componentInstance.dateSelected.subscribe(date => fixture.componentRef.setInput('selectedDate', date));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('labels dates, disables outside days, retains complete workout labels, and keeps hydration/no-ops silent', async () => {
    const fixture = await render();
    const date = fixture.nativeElement.querySelector('[data-plan-date="2026-09-08"]') as HTMLButtonElement;
    expect(date.disabled).toBe(true);
    expect(date.getAttribute('aria-label')).toContain('Outside this plan');
    expect(fixture.nativeElement.querySelector('.calendar-workout')?.getAttribute('aria-label')).toBe(`Edit ${workout.title}, skipped`);
    expect(fixture.nativeElement.querySelector('.calendar-workout--skipped')).toBeTruthy();
    fixture.componentInstance.selectDate('2026-09-09');
    fixture.componentInstance.selectDate(null);
    fixture.componentInstance.selectDate('2026-10-07');
    expect(selection).not.toHaveBeenCalled();
    (fixture.nativeElement.querySelector('[data-plan-date="2026-09-12"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedDate()).toBe('2026-09-12');
    expect(selection).toHaveBeenCalledOnce();
  });

  it('navigates months within the range and keeps arrow-key selection and focus together across months', async () => {
    const fixture = await render();
    (fixture.nativeElement.querySelector('[aria-label="Next plan month"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedDate()).toBe('2026-10-01');
    expect(document.activeElement?.getAttribute('data-plan-date')).toBe('2026-10-01');
    expect((fixture.nativeElement.querySelector('[aria-label="Next plan month"]') as HTMLButtonElement).disabled).toBe(true);
    const current = fixture.nativeElement.querySelector('[data-plan-date="2026-10-01"]') as HTMLButtonElement;
    current.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedDate()).toBe('2026-09-30');
    expect(document.activeElement?.getAttribute('data-plan-date')).toBe('2026-09-30');
    expect(selection).toHaveBeenCalledTimes(2);
    fixture.componentInstance.onDayKeydown(new KeyboardEvent('keydown', { key: 'PageDown' }), '2026-09-30');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedDate()).toBe(plan.endLocalDate);
  });

  it('opens a workout without a nested button and disables navigation and edits during mutation', async () => {
    const fixture = await render();
    const edit = vi.fn();
    fixture.componentInstance.workoutSelected.subscribe(edit);
    (fixture.nativeElement.querySelector('.calendar-workout') as HTMLButtonElement).click();
    expect(edit).toHaveBeenCalledWith(workout);
    expect(selection).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('button button')).toBeNull();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('button')].every((button: HTMLButtonElement) => button.disabled)).toBe(true);
    fixture.componentInstance.selectDate('2026-09-12');
    fixture.componentInstance.editWorkout(workout);
    fixture.componentInstance.onDayKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), '2026-09-09');
    expect(selection).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledOnce();
  });
});
