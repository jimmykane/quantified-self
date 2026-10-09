import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { buildCalendarPeriodSummary, type CalendarPeriodSummary } from '../../../helpers/calendar-period-summary.helper';
import { CalendarPeriodSummaryComponent } from './calendar-period-summary.component';
import { ActivityTypes, DataAscent, DataDistance, DataDuration, type EventInterface } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import { writeFileSync } from 'node:fs';

const workout: ScheduledWorkoutV1 = {
  schemaVersion: 1, id: 'synthetic', planId: null, localDate: '2026-10-06', lifecycle: 'planned', title: 'Easy run',
  revision: 1, createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running, nodes: [
    { kind: 'step', id: 'time', purpose: 'work', ending: { kind: 'time', seconds: 600.25 }, targets: [] },
    { kind: 'step', id: 'manual', purpose: 'recovery', ending: { kind: 'manual' }, targets: [] },
  ] },
};
const input = () => ({
  period: 'month' as 'week' | 'month', window: { startMs: 1, endExclusiveMs: 2 },
  startLocalDate: '2026-10-01', endLocalDate: '2026-10-31',
  events: { status: 'ready' as const, data: [] as EventInterface[], complete: true },
  completions: { status: 'ready' as const, data: [], complete: true },
  schedule: { status: 'ready' as const, complete: true, data: { state: { activePlanId: null }, workouts: [] as ScheduledWorkoutV1[] } },
});
function exportFixture(fixture: ComponentFixture<CalendarPeriodSummaryComponent>, name: string): void {
  // Synthetic snapshots for browser layout QA; no account data or separate production markup.
  if (process.env.CALENDAR_PERIOD_QA_DIR) writeFileSync(`${process.env.CALENDAR_PERIOD_QA_DIR}/${name}.html`,
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css">${Array.from(document.head.querySelectorAll('style')).map(style => style.outerHTML).join('')}</head><body><main class="qs-workspace-page"><div class="qs-glass-card-panel" style="padding:16px;max-width:960px;margin:auto"><app-calendar-period-summary>${fixture.nativeElement.innerHTML}</app-calendar-period-summary></div></main></body></html>`);
}

describe('Calendar period summary presentation', () => {
  const selection = vi.fn();
  beforeEach(async () => {
    selection.mockClear();
    await TestBed.configureTestingModule({ imports: [CalendarPeriodSummaryComponent],
      providers: [{ provide: AppHapticsService, useValue: { selection } }] }).compileComponents();
  });
  async function render(summary: CalendarPeriodSummary) {
    const fixture = TestBed.createComponent(CalendarPeriodSummaryComponent);
    fixture.componentRef.setInput('summary', summary);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    return fixture;
  }
  async function refresh(fixture: ComponentFixture<CalendarPeriodSummaryComponent>, summary: CalendarPeriodSummary) {
    fixture.componentRef.setInput('summary', summary);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  }

  it.each(['week', 'month'] as const)('hides empty %s planning entirely while keeping recorded totals first', async period => {
    const value = input(); value.period = period;
    const stats = { [DataDuration.type]: 176340, [DataDistance.type]: 389780, [DataAscent.type]: 7973, 'Training Stress Score': 3652 };
    value.events.data = [{ startDate: new Date(1), getID: () => 'synthetic-recording',
      getStat: (type: string) => stats[type] === undefined ? null : { getValue: () => stats[type] },
      getActivityTypesAsArray: () => [ActivityTypes.Running] } as EventInterface];
    const fixture = await render(buildCalendarPeriodSummary(value));
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
    expect(fixture.nativeElement.querySelector('.period-counts')).toBeNull();
    expect(fixture.nativeElement.querySelector('.planning-totals')).toBeNull();
    expect(fixture.nativeElement.querySelector('.activity-count').textContent).toBe('1 activity');
    expect(fixture.nativeElement.querySelector('.recorded-metrics').textContent).toContain('389.78 Km');
    expect(fixture.nativeElement.textContent).not.toMatch(/prescription|unlinked|coverage|Completed links|No workouts/);
    expect(fixture.nativeElement.querySelector('.planning-slot')).toBeNull();
    exportFixture(fixture, 'empty-plan');
  });

  it('does not render empty activity metrics for a fully empty month', async () => {
    const fixture = await render(buildCalendarPeriodSummary(input()));
    expect(fixture.nativeElement.textContent).toContain('No activities this month');
    expect(fixture.nativeElement.querySelector('.recorded-metrics')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
  });

  it('starts planning closed with counts visible and uses the same flexible header size when expanded', async () => {
    const value = input(); value.schedule.data.workouts = [workout];
    const fixture = await render(buildCalendarPeriodSummary(value));
    const header = fixture.nativeElement.querySelector('mat-expansion-panel-header') as HTMLElement;
    expect(header.textContent).toContain('1 scheduled');
    expect(header.textContent).toContain('1 remaining');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.mat-expansion-panel-content-wrapper').hasAttribute('inert')).toBe(true);
    const headerHeight = header.style.height;
    expect(headerHeight).toBe('auto');
    exportFixture(fixture, 'planned-collapsed');
    header.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.style.height).toBe(headerHeight);
    expect(fixture.nativeElement.querySelector('.mat-expansion-panel-content-wrapper').hasAttribute('inert')).toBe(false);
    expect(fixture.nativeElement.querySelector('.planning-totals').textContent).toContain('Plus steps with no set time');
    expect(fixture.nativeElement.querySelector('.period-counts').textContent).not.toContain('Skipped');
    expect(selection).toHaveBeenCalledTimes(1);
    exportFixture(fixture, 'planned-expanded');
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    fixture.detectChanges();
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps details open on live updates and closes them when the displayed period changes', async () => {
    const value = input(); value.schedule.data.workouts = [workout];
    const fixture = await render(buildCalendarPeriodSummary(value));
    fixture.nativeElement.querySelector('mat-expansion-panel-header').click(); fixture.detectChanges();
    await refresh(fixture, buildCalendarPeriodSummary({ ...value, events: { ...value.events, complete: false } }));
    expect(fixture.nativeElement.querySelector('mat-expansion-panel-header').getAttribute('aria-expanded')).toBe('true');
    await refresh(fixture, buildCalendarPeriodSummary({ ...value, startLocalDate: '2026-10-05', endLocalDate: '2026-10-11', period: 'week' }));
    expect(fixture.nativeElement.querySelector('mat-expansion-panel-header').getAttribute('aria-expanded')).toBe('false');
  });

  it('removes empty planning after a live update and makes its leaving area inaccessible', async () => {
    const value = input(); value.schedule.data.workouts = [workout];
    const fixture = await render(buildCalendarPeriodSummary(value));
    fixture.nativeElement.querySelector('mat-expansion-panel-header').click(); fixture.detectChanges();
    value.schedule.data.workouts = [];
    await refresh(fixture, buildCalendarPeriodSummary(value));
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
    expect(fixture.nativeElement.querySelector('[inert][aria-hidden="true"]')).toBeTruthy();
  });

  it('retains skipped-only counts but hides both empty workout totals', async () => {
    const value = input(); value.schedule.data.workouts = [{ ...workout, lifecycle: 'skipped' }];
    const fixture = await render(buildCalendarPeriodSummary(value));
    expect(fixture.nativeElement.querySelector('mat-expansion-panel-header').textContent).toContain('Nothing remaining');
    expect(fixture.nativeElement.querySelector('.period-counts').textContent).toContain('Skipped');
    expect(fixture.nativeElement.querySelectorAll('.planning-totals > section')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).not.toContain('No workouts');
  });

  it('hides the remaining totals when every planned workout has an activity', async () => {
    const value = input(); value.schedule.data.workouts = [workout];
    const summary = buildCalendarPeriodSummary({ ...value, completions: { status: 'ready', complete: true, data: [{
      schemaVersion: 1, workoutId: workout.id, planId: null, provider: 'garmin', matchMethod: 'provider_marker',
      eventId: 'synthetic-activity', activityId: null, sourceSessionIndex: null, activityStartAtMs: 1,
      scheduledLocalDate: workout.localDate, workoutRevisionAtLink: workout.revision, timing: 'on_date', linkedAtMs: 1, updatedAtMs: 1,
    }] } });
    const fixture = await render(summary);
    expect(fixture.nativeElement.querySelector('mat-expansion-panel-header').textContent).toContain('Nothing remaining');
    expect(fixture.nativeElement.querySelector('[aria-label="Planned workout totals"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[aria-label="Remaining workout totals"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.period-counts').textContent).toContain('With an activity');
    expect(fixture.nativeElement.querySelector('.period-counts').textContent).not.toContain('Remaining');
  });

  it('shows a simple incomplete-read warning even when no workouts have loaded', async () => {
    const value = input(); value.schedule.complete = false;
    const fixture = await render(buildCalendarPeriodSummary(value));
    expect(fixture.nativeElement.textContent).toContain('Some planned workouts may be missing');
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('No workouts');
    value.schedule.data.workouts = [workout];
    await refresh(fixture, buildCalendarPeriodSummary(value));
    expect(fixture.nativeElement.querySelector('mat-expansion-panel-header').textContent).toContain('At least 1 scheduled');
    expect(fixture.nativeElement.textContent).toContain('from workouts loaded');
  });

  it('shows loading separately and never briefly flashes zero planning counts', async () => {
    const value = input();
    const fixture = await render(buildCalendarPeriodSummary({ ...value, schedule: { status: 'loading', data: null, complete: false } }));
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
    await refresh(fixture, buildCalendarPeriodSummary({ ...value, completions: { status: 'loading', data: [], complete: false } }));
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
    value.schedule.data.workouts = [workout];
    await refresh(fixture, buildCalendarPeriodSummary({ ...value, completions: { status: 'loading', data: [], complete: false } }));
    expect(fixture.nativeElement.querySelector('mat-expansion-panel-header').textContent).toContain('Checking activities');
    expect(fixture.nativeElement.querySelector('.period-counts').textContent).toContain('Checking');
  });

  it.each(['week', 'month'] as const)('keeps %s failure visible without empty panels and offers one accessible retry', async period => {
    const fixture = await render(buildCalendarPeriodSummary({ ...input(), period,
      events: { status: 'error', data: [], complete: false }, schedule: { status: 'error', data: null, complete: false },
      completions: { status: 'error', data: [], complete: false },
    }));
    fixture.componentRef.setInput('canRetry', true); fixture.detectChanges();
    const retry = vi.fn(); fixture.componentInstance.retryRequested.subscribe(retry);
    expect(selection).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('mat-expansion-panel')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Activities could not be loaded');
    expect(fixture.nativeElement.textContent).toContain('Planned workouts could not be loaded');
    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].type).toBe('button'); expect(buttons[0].textContent).toContain('Try again');
    buttons[0].click(); expect(retry).toHaveBeenCalledTimes(1); expect(selection).toHaveBeenCalledTimes(1);
  });
});
