import { ActivityTypes, DataDuration, type EventInterface } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import type { TimelineNote } from '@shared/timeline-notes';
import { buildDashboardDailyBriefing, dashboardBriefingWindow, dashboardBriefingSleepDuration, type DashboardBriefingContext } from './dashboard-daily-briefing.helper';

const now = new Date(2026, 9, 16, 12).getTime();
const utcDayMs = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
const workout = (id: string, extra: Partial<ScheduledWorkoutV1> = {}): ScheduledWorkoutV1 => ({ schemaVersion: 1, id,
  planId: null, localDate: '2026-10-16', lifecycle: 'planned', title: id, revision: 2, createdAtMs: 1, updatedAtMs: 2,
  structure: { version: 1, sport: ActivityTypes.Running, nodes: [] }, ...extra });
const link = (id: string, extra: Partial<TrainingWorkoutCompletionV1> = {}): TrainingWorkoutCompletionV1 => ({ schemaVersion: 1,
  workoutId: id, planId: null, provider: 'garmin', matchMethod: 'provider_marker', eventId: 'event', activityId: null,
  sourceSessionIndex: null, activityStartAtMs: now - 86400000, scheduledLocalDate: '2026-10-15',
  workoutRevisionAtLink: 1, timing: 'early', linkedAtMs: 1, updatedAtMs: 1, ...extra });
const event = (id: string, time = now - 1000, seconds?: number): EventInterface => ({ startDate: new Date(time),
  getID: () => id, getStat: (type: string) => type === DataDuration.type && seconds !== undefined ? { getValue: () => seconds } : null,
} as EventInterface);
function input(): DashboardBriefingContext {
  return { nowMs: now, window: dashboardBriefingWindow(now, 1), locale: 'en-GB', signals: [],
    events: { status: 'ready', complete: true, data: [] },
    schedule: { status: 'ready', complete: true, data: { state: { activePlanId: 'active' }, workouts: [] } },
    completions: { status: 'ready', complete: true, data: [] }, notes: [], notesReady: true };
}
const note = (id: string, extra: Partial<TimelineNote> = {}): TimelineNote => ({ id, revision: 1, title: id,
  category: 'other', startDate: '2026-10-15', endDate: '2026-10-17', timeZone: 'Europe/Helsinki',
  createdAtMs: 1, updatedAtMs: 1, ...extra });

describe('Dashboard daily briefing', () => {
  it('does not arbitrarily attribute sleep duration when sources share a timestamp', () => {
    const point = { endTimeMs: now, totalSeconds: 7 * 3600, providerLabel: 'Suunto' };
    expect(dashboardBriefingSleepDuration([point], now)).toBe('last night’s Suunto sleep was 07h 00m 00s');
    expect(dashboardBriefingSleepDuration([point, { ...point, providerLabel: 'Garmin' }], now)).toBe('');
    expect(dashboardBriefingSleepDuration([{ ...point, isNap: true }], now)).toBe('');
    expect(dashboardBriefingSleepDuration([{ ...point, totalSeconds: NaN }], now)).toBe('');
    expect(dashboardBriefingSleepDuration([point], now - 1)).toBe('');
  });
  it('keeps planned workouts separate from actual recordings and deduplicates parents', () => {
    const value = input(); value.schedule.data!.workouts = [workout('Easy run')];
    value.completions.data = [link('Easy run')];
    const recorded = event('multisport', undefined, 1800);
    value.events.data = [recorded, recorded, event('future', now + 1), event('yesterday', now - 86400000)];
    const text = buildDashboardDailyBriefing(value).headline;
    expect(text).toContain('1 workout recorded today (30m 00s)');
    expect(text).toContain('“Easy run” on today’s plan with linked activity evidence');
    expect(text).not.toMatch(/completed|adherence/);
  });
  it('excludes inactive/deleted/skipped plans and preserves exact links after revision changes', () => {
    const value = input(); value.schedule.data!.workouts = [workout('a'), workout('inactive', { planId: 'old' }),
      workout('deleted', { lifecycle: 'deleted' }), workout('skipped', { lifecycle: 'skipped' })];
    value.completions.data = [link('a')];
    const text = buildDashboardDailyBriefing(value).headline;
    expect(text).toContain('1 of 1 workout scheduled this week has linked activities');
    expect(text).not.toMatch(/inactive|deleted|skipped|completed/);
  });
  it('never turns failed, loading, partial or invalid link reads into zero completion or rest claims', () => {
    for (const status of ['loading', 'error'] as const) {
      const value = input(); value.schedule.data!.workouts = [workout('Run')]; value.completions.status = status;
      const text = buildDashboardDailyBriefing(value).headline;
      expect(text).toContain('“Run” on today’s plan'); expect(text).not.toMatch(/0 of|rest|completed|with linked/);
    }
    const value = input(); value.schedule.data!.workouts = [workout('Run')]; value.schedule.complete = false;
    expect(buildDashboardDailyBriefing(value).headline).toContain('plan list may be incomplete');
    expect(buildDashboardDailyBriefing(value).headline).not.toContain('0 of');
    value.schedule.complete = true; value.completions.data = [link('Run', { workoutRevisionAtLink: 99 })];
    expect(buildDashboardDailyBriefing(value).headline).not.toContain('0 of');
  });
  it('uses only active visible notes, bounded literal titles and no causal claims', () => {
    const value = input(); value.notes = [note('First'), note('Hidden', { showOnCharts: false }),
      note('Expired', { endDate: '2026-10-15' }), note('Future', { startDate: '2026-10-17' }), note('Long'.repeat(80))];
    const text = buildDashboardDailyBriefing(value).headline;
    expect(text).toContain('Active note: “First” and 1 more'); expect(text).not.toMatch(/Hidden|Expired|Future|caused/);
    value.notesReady = false; expect(buildDashboardDailyBriefing(value).headline).not.toContain('active note');
  });
  it('offers next-session context and weekly progress without inventing a key workout', () => {
    const value = input(); value.schedule.data!.workouts = [workout('Swim', { localDate: '2026-10-17' })];
    expect(buildDashboardDailyBriefing(value).headline).toContain('next on your plan is “Swim” on Sat 17 Oct');
    value.completions.data = [link('Swim')]; expect(buildDashboardDailyBriefing(value).headline).not.toContain('next on');
  });
  it('selects existing assessments and conditional load/recovery/sleep copy without an expansion', () => {
    const value = input(); value.signals = [{ id: 'readiness', label: 'Readiness', sourceLabel: 'Derived', state: 'attention',
      statusText: 'Mixed', summaryText: 'Readiness is Mixed', detailText: '' }];
    value.loadComparison = { direction: 'higher', utcDayMs }; value.recoveryFinishTimeMs = now + 7200000; value.sleepText = 'last night’s Suunto sleep was 7h';
    const result = buildDashboardDailyBriefing(value);
    expect(result.tone).toBe('caution'); expect(result.headline).toContain('Readiness is Mixed');
    expect(result.headline).toContain('above your four-week weekly average');
    expect(result.headline).toContain('imported recovery remaining is 02h 00m'); expect(result.headline).toContain('Suunto sleep');
  });
  it('does not fabricate missing duration or complete partial recordings', () => {
    const value = input(); value.events.data = [event('a')]; value.events.complete = false;
    const text = buildDashboardDailyBriefing(value).headline;
    expect(text).toContain('At least 1 workout recorded today'); expect(text).not.toContain('(');
  });
  it('keeps unavailable readiness verbal even when a workout is present', () => {
    const value = input(); value.events.data = [event('run')];
    value.signals = [{ id: 'readiness', label: 'Readiness', sourceLabel: '', state: 'unavailable',
      statusText: 'Unavailable', summaryText: 'Readiness is unavailable', detailText: '' }];
    expect(buildDashboardDailyBriefing(value)).toMatchObject({ tone: 'error', headline: expect.stringContaining('Readiness is unavailable') });
  });
  it.each(['loading', 'unavailable', 'insufficient'] as const)('does not let recovery context hide %s readiness on a quiet day', state => {
    const value = input(); value.recoveryFinishTimeMs = now + 7200000;
    value.signals = [{ id: 'readiness', label: 'Readiness', sourceLabel: '', state,
      statusText: state, summaryText: `Readiness is ${state}`, detailText: '' }];
    const result = buildDashboardDailyBriefing(value);
    expect(result.headline).toContain(`Readiness is ${state}`);
    expect(result.headline).toContain('imported recovery remaining is 02h 00m');
    value.loadComparison = { direction: 'higher', utcDayMs };
    if (state === 'unavailable') expect(buildDashboardDailyBriefing(value).tone).toBe('error');
  });
  it('isolates today and this week from an invalid completion outside this week', () => {
    const value = input(); value.schedule.data!.workouts = [workout('today'), workout('future', { localDate: '2026-10-19' })];
    value.completions.data = [link('today'), link('future', { workoutRevisionAtLink: 99 })];
    const text = buildDashboardDailyBriefing(value).headline;
    expect(text).toContain('on today’s plan with linked activity evidence');
    expect(text).toContain('1 of 1 workout scheduled this week has linked activities');
    expect(text).not.toContain('next on');
  });
  it('does not let an invalid earlier completion hide a known future session', () => {
    const value = input(); value.schedule.data!.workouts = [workout('earlier', { localDate: '2026-10-15' }),
      workout('Swim', { localDate: '2026-10-17' })];
    value.completions.data = [link('earlier', { workoutRevisionAtLink: 99 })];
    const text = buildDashboardDailyBriefing(value).headline;
    expect(text).toContain('Next on your plan is “Swim”');
    expect(text).not.toContain('0 of');
  });
  it('does not let an invalid skipped future link hide the next non-skipped session', () => {
    const value = input(); value.schedule.data!.workouts = [workout('skipped', { localDate: '2026-10-17', lifecycle: 'skipped' }),
      workout('Swim', { localDate: '2026-10-18' })]; value.completions.data = [link('skipped', { workoutRevisionAtLink: 99 })];
    expect(buildDashboardDailyBriefing(value).headline).toContain('Next on your plan is “Swim”');
  });
  it('expires the load clause when the UTC snapshot day changes, without a new source emission', () => {
    const value = input(); value.nowMs = utcDayMs + 86400000 - 1;
    value.loadComparison = { direction: 'higher', utcDayMs };
    expect(buildDashboardDailyBriefing(value).headline).toContain('above your four-week weekly average');
    value.nowMs++;
    expect(buildDashboardDailyBriefing(value).headline).not.toContain('above your four-week weekly average');
    value.loadComparison.utcDayMs = utcDayMs + 86400000;
    expect(buildDashboardDailyBriefing(value).headline).toContain('above your four-week weekly average');
  });
  it('does not keep an expired recovery estimate after the page resumes', () => {
    const value = input(); value.recoveryFinishTimeMs = now + 7200000;
    expect(buildDashboardDailyBriefing(value).headline).toContain('Imported recovery remaining');
    value.nowMs += 3600000;
    expect(buildDashboardDailyBriefing(value).headline).toContain('Imported recovery remaining is 01h 00m');
    value.nowMs += 2 * 3600000;
    expect(buildDashboardDailyBriefing(value).headline).not.toMatch(/imported recovery remaining/i);
  });
  it.each([null, undefined, NaN, Infinity, now - 1, now, now + 500])('omits missing, invalid or expired recovery deadline %s', recoveryFinishTimeMs => {
    expect(buildDashboardDailyBriefing({ ...input(), recoveryFinishTimeMs }).headline).not.toMatch(/imported recovery remaining/i);
  });
  it('does not color the rail for a load clause omitted by the sentence budget', () => {
    const value = input(); const recording = event('ride', undefined, 3600);
    recording.name = 'R'.repeat(100); value.events.data = [recording];
    value.schedule.data!.workouts = [workout('planned', { title: 'P'.repeat(100) })];
    value.completions.data = [link('planned')]; value.notes = [note('travel', { title: 'N'.repeat(120) })];
    value.signals = [{ id: 'readiness', label: 'Readiness', sourceLabel: '', state: 'insufficient',
      statusText: 'Awaiting sleep', summaryText: 'Readiness is waiting for today’s sleep', detailText: '' }];
    value.loadComparison = { direction: 'higher', utcDayMs };
    const result = buildDashboardDailyBriefing(value);
    expect(result.headline).not.toContain('four-week'); expect(result.tone).toBe('neutral');
  });
  it('uses local midnight, configured week start and calendar-day lookahead', () => {
    const sunday = new Date(2026, 9, 25, 23, 59);
    const window = dashboardBriefingWindow(sunday.getTime(), 1);
    expect(window).toMatchObject({ today: '2026-10-25', weekStart: '2026-10-19', weekEnd: '2026-10-25', scheduleEnd: '2026-11-01' });
    expect(new Date(window.tomorrowMs).getHours()).toBe(0);
    expect(dashboardBriefingWindow(new Date(2026, 9, 25).getTime(), 0).weekStart).toBe('2026-10-25');
  });
  it('shows the actual recording name and bounds long literal note/workout titles', () => {
    const value = input(); const recording = event('ride'); recording.name = 'Morning ride'; value.events.data = [recording];
    value.notes = [note('long', { title: 'Long\n'.repeat(100) })];
    value.schedule.data!.workouts = [workout('planned', { title: 'Plan '.repeat(100) })];
    const text = buildDashboardDailyBriefing(value).headline;
    expect(text).toContain('recorded today: “Morning ride”'); expect(text).toContain('…');
    expect(text.length).toBeLessThan(400); expect(text).not.toContain('\n');
  });
});
