import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonToggle } from '@angular/material/button-toggle';
import { DistanceUnits, PaceUnits } from '@sports-alliance/sports-lib';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { WorkoutProfileComponent } from '../plans/workout-profile.component';
import { PlanScheduleCalendarComponent } from '../plans/plan-schedule-calendar.component';
import { TrainingPlansPreviewComponent } from './training-plans-preview.component';

describe('TrainingPlansPreviewComponent', () => {
  const selection = vi.fn();

  beforeEach(async () => {
    selection.mockClear();
    await TestBed.configureTestingModule({
      imports: [TrainingPlansPreviewComponent, NoopAnimationsModule],
      providers: [
        { provide: AppHapticsService, useValue: { selection } },
        { provide: EChartsLoaderService, useValue: {
          init: vi.fn().mockResolvedValue({ on: vi.fn(), off: vi.fn(), dispatchAction: vi.fn(), isDisposed: () => false }),
          setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
          subscribeToViewportResize: vi.fn(() => vi.fn()), attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
        } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('opens the real profile locally with canonical totals, target ranges and keyboard step selection', async () => {
    const fixture = TestBed.createComponent(TrainingPlansPreviewComponent);
    const original = JSON.stringify(fixture.componentInstance.workouts);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.debugElement.query(By.directive(WorkoutProfileComponent))).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-button-toggle-group').hasAttribute('hideSingleSelectionIndicator')).toBe(true);
    const toggle = fixture.debugElement.queryAll(By.directive(MatButtonToggle))
      .find(button => button.componentInstance.value === 'profile')!;
    toggle.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    await fixture.whenStable();

    const profile = fixture.debugElement.query(By.directive(WorkoutProfileComponent)).componentInstance as WorkoutProfileComponent;
    expect(profile.structure()).toBe(fixture.componentInstance.profileWorkout()!.workout.structure);
    expect(profile.steps()).toHaveLength(7);
    expect(profile.metric()).toBe('power');
    expect(profile.model()?.metrics).toContain('cadence');
    expect(fixture.nativeElement.textContent).toContain('This sample is read-only; nothing is saved');
    expect(fixture.nativeElement.textContent).toContain('Workout prescription');
    expect(fixture.nativeElement.textContent).toContain('Completed · activity linked');
    expect(fixture.nativeElement.querySelector('.profile-preview-totals').getAttribute('aria-label')).toBe('Workout prescription');
    expect(fixture.nativeElement.querySelector('.profile-preview-totals').textContent).toContain('48m');
    expect(profile.summary()).toContain('step order, not time or distance');
    expect(selection).toHaveBeenCalledOnce();

    const firstStep = fixture.nativeElement.querySelector('[data-profile-index="0"]') as HTMLButtonElement;
    firstStep.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(profile.selected()?.stepId).toBe('threshold');
    expect(fixture.nativeElement.querySelector('[data-profile-index="1"]').getAttribute('aria-pressed')).toBe('true');
    expect(selection).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fixture.componentInstance.workouts)).toBe(original);
  });

  it('preserves an empty date and keeps profile selection in sync when returning to the calendar', async () => {
    const fixture = TestBed.createComponent(TrainingPlansPreviewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.selectDate(component.preview.emptyDate);
    component.selectView('profile');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(WorkoutProfileComponent))).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Choose a sample workout');

    component.selectProfileWorkout('easy-aerobic-run');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.profileWorkout()?.workout.id).toBe('easy-aerobic-run');
    expect(component.selectedDate()).toBe(component.profileWorkout()?.workout.localDate);
    component.selectProfileWorkout('easy-aerobic-run');
    component.selectProfileWorkout('not-a-fixture');
    component.selectView('profile');
    expect(selection).toHaveBeenCalledTimes(2);
    component.selectView('calendar');
    fixture.detectChanges();
    await fixture.whenStable();
    const calendar = fixture.debugElement.query(By.directive(PlanScheduleCalendarComponent)).componentInstance;
    expect(calendar.selectedDate()).toBe(component.profileWorkout()?.workout.localDate);
    expect(fixture.nativeElement.querySelector('.selected-workout h5').textContent).toBe('Easy aerobic run');
  });

  it('uses shared metric/imperial formatting for profile instructions and prescription totals', async () => {
    const fixture = TestBed.createComponent(TrainingPlansPreviewComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectProfileWorkout('steady-10k-run');
    component.selectView('profile');
    fixture.detectChanges();
    await fixture.whenStable();
    let profile = fixture.debugElement.query(By.directive(WorkoutProfileComponent)).componentInstance as WorkoutProfileComponent;
    expect(profile.steps()[0].targetsText).toContain('min/km');
    expect(component.profileWorkout()?.totals).toContain('10.00 Km');

    fixture.componentRef.setInput('unitSettings', { distanceUnits: DistanceUnits.Miles, paceUnits: [PaceUnits.MinutesPerMile] });
    fixture.detectChanges();
    await fixture.whenStable();
    profile = fixture.debugElement.query(By.directive(WorkoutProfileComponent)).componentInstance;
    expect(profile.steps()[0].targetsText).toBe('08:18–08:51 min/m');
    expect(component.profileWorkout()?.totals).toContain('mi prescribed');
    expect(component.profileWorkout()?.workout.structure.nodes[0]).toMatchObject({ ending: { kind: 'distance', meters: 10000 } });
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
    expect(emptyDate.getAttribute('aria-label')).toContain('Phase: Build');
    expect(emptyDate.closest('.calendar-day')?.querySelector('.calendar-phase')?.textContent).toBe('Build');
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
