import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { buildCalendarPeriodSummary, type CalendarPeriodSummary } from '../../../helpers/calendar-period-summary.helper';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import { CalendarMonthTotalsComponent } from './calendar-month-totals.component';

describe('CalendarMonthTotalsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarMonthTotalsComponent],
    }).compileComponents();
  });

  async function render(summary: CalendarPeriodSummary) {
    const fixture = TestBed.createComponent(CalendarMonthTotalsComponent);
    fixture.componentRef.setInput('summary', summary);
    fixture.componentRef.setInput('periodLabel', 'September 2026');
    fixture.componentRef.setInput('activityMetrics', [
      { label: 'Distance', icon: 'route', value: '182.84 Km' },
      { label: 'Duration', icon: 'schedule', value: '12h' },
      { label: 'Ascent', icon: 'terrain', value: '2,500 m' },
    ]);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    return fixture;
  }
  async function refresh(fixture: ComponentFixture<CalendarMonthTotalsComponent>, summary: CalendarPeriodSummary) {
    fixture.componentRef.setInput('summary', summary);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  }
  function values(fixture: ComponentFixture<CalendarMonthTotalsComponent>, row: 'activity' | 'workout' = 'workout'): string[] {
    return [...fixture.nativeElement.querySelectorAll(`.calendar-${row}-totals .calendar-period-summary-value`)]
      .map((element: HTMLElement) => element.textContent?.trim());
  }

  it('shows workouts below the original activity totals without a toggle', async () => {
    const fixture = await render(buildCalendarPeriodSummary(input()));
    expect(values(fixture, 'activity')).toEqual(['182.84 Km', '12h', '2,500 m']);
    expect(values(fixture)).toEqual(['3', '1', '1']);
    expect([...fixture.nativeElement.querySelectorAll('section')].map((element: HTMLElement) => element.getAttribute('aria-label')))
      .toEqual(['September 2026 activity totals', 'September 2026 workout totals']);
    expect(fixture.nativeElement.querySelectorAll('.calendar-activity-totals mat-icon')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('[matMenuTriggerFor]')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-menu')).toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').textContent).toContain('1h planned · 30m left · 1 skipped');
  });

  it('opens full caption details on click without requiring a hover or long press', async () => {
    const fixture = await render(buildCalendarPeriodSummary(input()));
    const caption = fixture.debugElement.query(By.css('.calendar-totals-caption'));
    const tooltip = caption.injector.get(MatTooltip);
    const show = vi.spyOn(tooltip, 'show');
    expect(caption.nativeElement.tagName).toBe('BUTTON');
    expect(caption.nativeElement.getAttribute('type')).toBe('button');
    expect(tooltip.touchGestures).toBe('off');
    expect(caption.nativeElement.getAttribute('aria-label')).toContain('1 skipped');
    expect(caption.nativeElement.getAttribute('aria-label')).toContain('matching activity');
    caption.nativeElement.click(); fixture.detectChanges();
    expect(show).toHaveBeenCalledOnce();
    await fixture.whenStable(); fixture.detectChanges();
    expect(document.querySelector('.mat-mdc-tooltip-surface').textContent).toContain('matching activity');
    expect(document.querySelector('.mat-mdc-tooltip-surface').textContent).toContain('1 skipped');
  });

  it('omits the workout row for an empty month, including when all loaded workouts are outside it', async () => {
    const value = input(); value.schedule.data.workouts.forEach(workout => { workout.localDate = '2026-10-01'; });
    const fixture = await render(buildCalendarPeriodSummary(value));
    expect(fixture.nativeElement.querySelector('.calendar-workout-totals')).toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption')).toBeNull();
    expect(values(fixture, 'activity')).toEqual(['182.84 Km', '12h', '2,500 m']);
  });

  it('adds and removes the workout row during refresh and month navigation while keeping activity totals', async () => {
    const value = input();
    const empty = { ...value, schedule: { ...value.schedule, data: { ...value.schedule.data, workouts: [] } } };
    const fixture = await render(buildCalendarPeriodSummary(empty));
    const activityRow = fixture.nativeElement.querySelector('.calendar-activity-totals');
    await refresh(fixture, buildCalendarPeriodSummary(value));
    expect(values(fixture)).toEqual(['3', '1', '1']);
    await refresh(fixture, buildCalendarPeriodSummary(empty));
    expect(fixture.nativeElement.querySelector('.calendar-workout-totals')).toBeNull();
    await refresh(fixture, buildCalendarPeriodSummary(value));
    expect(values(fixture)).toEqual(['3', '1', '1']);
    await refresh(fixture, buildCalendarPeriodSummary({ ...value, startLocalDate: '2026-10-01', endLocalDate: '2026-10-31' }));
    expect(fixture.nativeElement.querySelector('.calendar-workout-totals')).toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-activity-totals')).toBe(activityRow);
    expect(values(fixture, 'activity')).toEqual(['182.84 Km', '12h', '2,500 m']);
  });

  it.each(['loading', 'error', 'conflict'] as const)('keeps unknown completion counts unknown during %s', async state => {
    const value = input();
    if (state === 'conflict') value.completions.data[0].planId = 'another-plan';
    else { value.completions.status = state; value.completions.complete = false; }
    const fixture = await render(buildCalendarPeriodSummary(value));
    expect(values(fixture)).toEqual(['3', '—', '—']);
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').textContent)
      .toContain(state === 'loading' ? 'Checking activities…' : 'Activity matches unavailable');
    expect(fixture.nativeElement.querySelector('.calendar-workout-totals').getAttribute('aria-busy')).toBe(String(state === 'loading'));
  });

  it('labels incomplete schedule counts as lower bounds and withholds complete time totals', async () => {
    const value = input(); value.schedule.complete = false;
    const fixture = await render(buildCalendarPeriodSummary(value));
    expect(values(fixture)).toEqual(['≥3', '≥1', '≥1']);
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').textContent).toContain('Some workouts may be missing');
  });

  it('does not convert workouts without set times into zero duration', async () => {
    const value = input(); value.schedule.data.workouts[1].structure.nodes[0] = {
      kind: 'step', id: 'open', purpose: 'work', ending: { kind: 'manual' }, targets: [],
    };
    const fixture = await render(buildCalendarPeriodSummary(value));
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').textContent).toContain('Some workouts have no set time');
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').getAttribute('aria-label')).toContain('steps with no set time');
  });

  it('qualifies estimated and early-lap times and keeps their explanations accessible', async () => {
    const value = input();
    value.schedule.data.workouts[1].structure.nodes[0] = { kind: 'step', id: 'distance', purpose: 'work',
      ending: { kind: 'distance', meters: 6000 }, targets: [{ kind: 'speed', mode: 'absolute',
        minimumMetersPerSecond: 3, maximumMetersPerSecond: 4, presentation: 'pace' }] };
    const fixture = await render(buildCalendarPeriodSummary(value));
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').textContent).toContain('About');
    value.schedule.data.workouts[1].structure.nodes[0] = { kind: 'step', id: 'lap', purpose: 'work',
      ending: { kind: 'time', seconds: 1800, allowEarlyLap: true }, targets: [] };
    await refresh(fixture, buildCalendarPeriodSummary(value));
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').textContent).toContain('Up to 1h planned · Up to 30m left');
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').getAttribute('aria-label')).toContain('finish earlier');
  });

  it('keeps counts usable when workout times cannot be calculated', async () => {
    const summary = buildCalendarPeriodSummary(input());
    const fixture = await render({ ...summary, planned: null, plannedText: 'Totals unavailable' });
    expect(values(fixture)).toEqual(['3', '1', '1']);
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').textContent).toContain('Workout time unavailable');
  });

  it('keeps skipped-only months available with no invented planned or remaining time', async () => {
    const value = input(); value.schedule.data.workouts = [value.schedule.data.workouts[2]]; value.completions.data = [];
    const fixture = await render(buildCalendarPeriodSummary(value));
    expect(values(fixture)).toEqual(['1', '0', '0']);
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').textContent).toContain('0m planned · 0m left · 1 skipped');
  });

  it('keeps activity read status independent of workout totals', async () => {
    const fixture = await render(buildCalendarPeriodSummary(input()));
    const row = fixture.nativeElement.querySelector('.calendar-activity-totals');
    fixture.componentRef.setInput('activityStatus', 'loading'); fixture.detectChanges();
    expect(row.getAttribute('aria-busy')).toBe('true');
    expect(row.getAttribute('aria-description')).toBe('Loading activities…');
    expect(fixture.nativeElement.querySelector('.calendar-workout-totals').getAttribute('aria-busy')).toBe('false');
    fixture.componentRef.setInput('activityStatus', 'ready');
    fixture.componentRef.setInput('activitiesComplete', false); fixture.detectChanges();
    expect(row.getAttribute('aria-busy')).toBe('false');
    expect(row.getAttribute('aria-description')).toBe('Some activities may be missing');
    fixture.componentRef.setInput('activityStatus', 'error'); fixture.detectChanges();
    expect(row.getAttribute('aria-description')).toBe('Activities unavailable');
    expect(values(fixture)).toEqual(['3', '1', '1']);
    expect(fixture.nativeElement.querySelector('.calendar-totals-caption').textContent).toContain('1h planned · 30m left · 1 skipped');
  });
});

function input() {
  const workouts: ScheduledWorkoutV1[] = ['done', 'remaining', 'skipped'].map(id => ({
    schemaVersion: 1, id, planId: 'plan', localDate: '2026-09-18', lifecycle: id === 'skipped' ? 'skipped' : 'planned',
    title: id, revision: 1, createdAtMs: 1, updatedAtMs: 1,
    structure: { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'step', id: 'steady', purpose: 'work', ending: { kind: 'time', seconds: 1800 }, targets: [] },
    ] },
  }));
  const link: TrainingWorkoutCompletionV1 = { schemaVersion: 1, workoutId: 'done', planId: 'plan', provider: 'garmin',
    matchMethod: 'provider_marker', eventId: 'activity', activityId: null, sourceSessionIndex: null,
    activityStartAtMs: 1, scheduledLocalDate: '2026-09-18', workoutRevisionAtLink: 1, timing: 'on_date', linkedAtMs: 1, updatedAtMs: 1 };
  return { period: 'month' as const, window: { startMs: new Date(2026, 8, 1).getTime(), endExclusiveMs: new Date(2026, 9, 1).getTime() },
    startLocalDate: '2026-09-01', endLocalDate: '2026-09-30',
    events: { status: 'ready' as const, data: [], complete: true },
    schedule: { status: 'ready' as const, data: { state: { activePlanId: 'plan' }, workouts }, complete: true },
    completions: { status: 'ready' as 'ready' | 'loading' | 'error', data: [link], complete: true },
  };
}
