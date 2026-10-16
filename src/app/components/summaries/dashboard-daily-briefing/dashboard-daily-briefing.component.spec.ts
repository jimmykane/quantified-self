import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { ActivityTypes, type EventInterface } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import { DashboardDailyBriefingComponent } from './dashboard-daily-briefing.component';
import { AppUserService } from '../../../services/app.user.service';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { TrainingPlansService, type CurrentTrainingScheduleV1 } from '../../../services/training-plans.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { AppUserInterface } from '../../../models/app-user.interface';
import type { TimelineNoteChartContext } from '../../../helpers/timeline-notes-chart.helper';

const owner = { uid: 'owner', settings: { unitSettings: { startOfTheWeek: 1 } } } as AppUserInterface;
const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: 'run', planId: null, localDate: '2026-10-16', lifecycle: 'planned',
  title: 'Easy run', revision: 1, createdAtMs: 1, updatedAtMs: 1,
  structure: { version: 1, sport: ActivityTypes.Running, nodes: [] } };
const schedule = (workouts: ScheduledWorkoutV1[] = []): CurrentTrainingScheduleV1 => ({ state: { schemaVersion: 1,
  activePlanId: null, revision: 1, currentWorkoutCount: workouts.length, updatedAtMs: 1 }, plans: [], workouts, workoutsComplete: true });

describe('Dashboard daily briefing', () => {
  const authenticated = signal<AppUserInterface | null>(owner);
  let events: Subject<{ events: EventInterface[]; complete: boolean }>;
  let plans: Subject<CurrentTrainingScheduleV1>;
  let links: Subject<TrainingWorkoutCompletionV1[]>;
  const calendar = { watchSummaryEvents: vi.fn() };
  const training = { watchCalendarSchedule: vi.fn(), watchWorkoutCompletionsForWorkouts: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 9, 16, 12)); vi.clearAllMocks(); authenticated.set(owner);
    events = new Subject(); plans = new Subject(); links = new Subject();
    calendar.watchSummaryEvents.mockReturnValue(events); training.watchCalendarSchedule.mockReturnValue(plans);
    training.watchWorkoutCompletionsForWorkouts.mockReturnValue(links);
    TestBed.configureTestingModule({ imports: [DashboardDailyBriefingComponent], providers: [
      { provide: AppUserService, useValue: { user: authenticated } }, { provide: ActivityCalendarService, useValue: calendar },
      { provide: TrainingPlansService, useValue: training }, { provide: AppHapticsService, useValue: { selection: vi.fn() } },
    ] });
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });
  function create(user = owner) {
    const fixture = TestBed.createComponent(DashboardDailyBriefingComponent);
    fixture.componentRef.setInput('user', user); fixture.componentRef.setInput('signals', []); fixture.detectChanges();
    return fixture;
  }
  it('renders one sentence without expansion or duplicate metrics, using bounded exact-ID readers', () => {
    const fixture = create(); plans.next(schedule([workout])); events.next({ events: [], complete: true }); links.next([]);
    fixture.detectChanges(); const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role=status]')?.textContent).toContain('“Easy run” on today’s plan');
    expect(host.querySelector('button, dl')).toBeNull();
    expect(training.watchCalendarSchedule).toHaveBeenCalledWith('owner', '2026-10-12', '2026-10-23');
    expect(training.watchWorkoutCompletionsForWorkouts).toHaveBeenCalledWith('owner', ['run']);
  });
  it('does not read/render another owner and tears down on sign-out', () => {
    const fixture = create({ ...owner, uid: 'other' } as AppUserInterface);
    expect(calendar.watchSummaryEvents).not.toHaveBeenCalled(); expect(fixture.nativeElement.querySelector('section')).toBeNull();
    fixture.componentRef.setInput('user', owner); fixture.detectChanges(); expect(events.observed).toBe(true);
    authenticated.set(null); fixture.detectChanges(); expect(events.observed).toBe(false); expect(plans.observed).toBe(false);
    expect(fixture.nativeElement.querySelector('section')).toBeNull();
  });
  it('uses the current local date when authentication resolves after midnight', () => {
    authenticated.set(null); const fixture = create(); expect(calendar.watchSummaryEvents).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(2026, 9, 17, 12)); authenticated.set(owner); fixture.detectChanges();
    expect(calendar.watchSummaryEvents).toHaveBeenCalledWith(owner, {
      startMs: new Date(2026, 9, 17).getTime(), endExclusiveMs: new Date(2026, 9, 18).getTime(),
    });
    expect(calendar.watchSummaryEvents).toHaveBeenCalledTimes(1);
  });
  it('registers today’s notes once, renders edits as text and clears hidden notes', () => {
    const fixture = create(); const reportRange = vi.fn();
    const context: TimelineNoteChartContext = { ownerUid: 'owner', notes: [], select: vi.fn(), reportRange };
    fixture.componentRef.setInput('notesContext', context); fixture.componentRef.setInput('notesStatus', 'ready'); fixture.detectChanges();
    expect(reportRange).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('notesContext', { ...context, notes: [{ id: 'n', revision: 1, category: 'other',
      title: '<img src=x> Travel', startDate: '2026-10-15', endDate: null, timeZone: 'UTC', createdAtMs: 1, updatedAtMs: 1 }] });
    fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('<img src=x> Travel');
    expect(fixture.nativeElement.querySelector('img')).toBeNull(); expect(reportRange).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('notesContext', { ...context, notes: [] }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Travel'); fixture.destroy();
    expect(reportRange.mock.calls.at(-1)?.[1]).toBeNull();
  });
  it('does not reread each minute but rolls dates forward and unsubscribes on destroy', () => {
    const fixture = create(); plans.next(schedule()); links.next([]); events.next({ events: [], complete: true });
    vi.advanceTimersByTime(60_000); fixture.detectChanges(); expect(calendar.watchSummaryEvents).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(2026, 9, 17, 0, 1)); vi.advanceTimersByTime(60_000); fixture.detectChanges();
    expect(calendar.watchSummaryEvents).toHaveBeenCalledTimes(2);
    fixture.destroy(); expect(events.observed).toBe(false); expect(plans.observed).toBe(false); expect(links.observed).toBe(false);
  });
  it('moves the date-range registration when the same owner gets a replacement notes workspace', () => {
    const fixture = create(); const previous = vi.fn(); const replacement = vi.fn();
    const context: TimelineNoteChartContext = { ownerUid: 'owner', notes: [], select: vi.fn(), reportRange: previous };
    fixture.componentRef.setInput('notesContext', context); fixture.detectChanges();
    fixture.componentRef.setInput('notesContext', { ...context, reportRange: replacement }); fixture.detectChanges();
    expect(previous.mock.calls.at(-1)?.[1]).toBeNull();
    expect(replacement).toHaveBeenCalledWith(expect.any(Object), { startDate: '2026-10-16', endDate: '2026-10-16' });
    fixture.destroy(); expect(replacement.mock.calls.at(-1)?.[1]).toBeNull();
  });
  it('drops a previous UTC day’s load clause on the silent clock without new source data', () => {
    const utcDayMs = Date.UTC(2026, 9, 16);
    vi.setSystemTime(utcDayMs + 86400000 - 30_000);
    const fixture = create(); fixture.componentRef.setInput('loadComparison', { direction: 'higher', utcDayMs }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('above your four-week weekly average');
    vi.advanceTimersByTime(60_000); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('above your four-week weekly average');
  });
  it('refreshes and expires recovery on focus after suspension without rereading source data', () => {
    const fixture = create(); const nowMs = Date.now();
    fixture.componentRef.setInput('recoveryFinishTimeMs', nowMs + 7200000); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('recovery remaining is 02h 00m');
    vi.setSystemTime(nowMs + 3600000); window.dispatchEvent(new Event('focus')); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('recovery remaining is 01h 00m');
    vi.setSystemTime(nowMs + 10800000); window.dispatchEvent(new Event('focus')); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toMatch(/imported recovery remaining/i);
    expect(calendar.watchSummaryEvents).toHaveBeenCalledTimes(1);
  });
  it('withholds completion progress on restore/error rather than claiming a rest day', () => {
    const fixture = create(); training.watchWorkoutCompletionsForWorkouts.mockReturnValue(of([]));
    plans.next(schedule([workout])); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('0 of 1');
    plans.next({ ...schedule([workout]), restoreUnavailable: true }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('0 of 1');
    plans.error(new Error('offline')); events.error(new Error('offline')); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toMatch(/rest day|0 workouts/);
  });
  it('discards old completion subscriptions when the schedule changes', () => {
    const fixture = create(); plans.next(schedule([workout])); links.next([]); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('0 of 1');
    const nextLinks = new Subject<TrainingWorkoutCompletionV1[]>();
    training.watchWorkoutCompletionsForWorkouts.mockReturnValue(nextLinks);
    plans.next(schedule([{ ...workout, revision: 2 }])); fixture.detectChanges();
    expect(links.observed).toBe(false); expect(fixture.nativeElement.textContent).not.toContain('0 of 1');
    links.next([]); fixture.detectChanges(); expect(fixture.nativeElement.textContent).not.toContain('0 of 1');
    nextLinks.next([]); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('0 of 1');
    fixture.destroy(); expect(nextLinks.observed).toBe(false);
  });
});
