import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AppHapticsService } from '../../services/app.haptics.service';
import { PlanScheduleCalendarComponent } from '../plans/plan-schedule-calendar.component';
import { TrainingPlansPreviewComponent } from './training-plans-preview.component';

describe('TrainingPlansPreviewComponent', () => {
  const selection = vi.fn();

  beforeEach(async () => {
    selection.mockClear();
    await TestBed.configureTestingModule({
      imports: [TrainingPlansPreviewComponent, NoopAnimationsModule],
      providers: [{ provide: AppHapticsService, useValue: { selection } }],
    }).compileComponents();
  });

  it('reuses the real plan calendar and canonical workout summaries without account services', async () => {
    const fixture = TestBed.createComponent(TrainingPlansPreviewComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const calendar = fixture.debugElement.query(By.directive(PlanScheduleCalendarComponent)).componentInstance;
    expect(calendar.plan()).toBe(fixture.componentInstance.plan);
    expect(calendar.workouts()).toBe(fixture.componentInstance.workouts);
    expect(calendar.completedWorkoutIds()).toEqual(fixture.componentInstance.completedWorkoutIds);
    expect(calendar.workoutActionVerb()).toBe('Preview');
    expect(calendar.calendarHint()).toContain('nothing here is saved');
    expect(fixture.nativeElement.textContent).toContain('Threshold bike blocks');
    expect(fixture.nativeElement.textContent).toContain('3×');
    expect(fixture.nativeElement.textContent).toContain('245');
    expect(fixture.nativeElement.textContent).toContain('270');
    expect(fixture.nativeElement.textContent).toContain('Completed · activity linked');
    expect(fixture.nativeElement.textContent).not.toContain('Manual and free');
    expect(fixture.nativeElement.querySelector('.manual-label')).toBeNull();
    expect(selection).not.toHaveBeenCalled();
  });

  it('selects an empty date locally and exposes an accessible add-without-a-plan explanation', async () => {
    const fixture = TestBed.createComponent(TrainingPlansPreviewComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const emptyDate = fixture.nativeElement.querySelector(
      `[data-plan-date="${fixture.componentInstance.preview.emptyDate}"]`,
    ) as HTMLButtonElement;
    expect(emptyDate).toBeTruthy();
    expect(emptyDate.disabled).toBe(false);
    emptyDate.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.selectedDate()).toBe(fixture.componentInstance.preview.emptyDate);
    expect(fixture.nativeElement.textContent).toContain('This date is open');
    expect(fixture.nativeElement.textContent).toContain('without creating another plan');
    expect(selection).toHaveBeenCalledOnce();
  });

  it('lets the calendar navigate across the multi-month fixture and preview a skipped workout', async () => {
    const fixture = TestBed.createComponent(TrainingPlansPreviewComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.selectedDate()).toBe(fixture.componentInstance.today);
    const skippedWorkout = fixture.componentInstance.workouts.find(workout => workout.lifecycle === 'skipped')!;
    (fixture.nativeElement.querySelector('[aria-label="Next plan month"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    while (fixture.componentInstance.selectedDate().slice(0, 7) > skippedWorkout.localDate.slice(0, 7)) {
      (fixture.nativeElement.querySelector('[aria-label="Previous plan month"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
    }
    const skipped = fixture.nativeElement.querySelector('[aria-label^="Preview Long progression run"]') as HTMLButtonElement;
    expect(skipped).toBeTruthy();
    skipped.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedWorkoutId()).toBe('long-progression-run');
    expect(fixture.nativeElement.textContent).toContain('Trail Running · Skipped');
    expect(selection.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
