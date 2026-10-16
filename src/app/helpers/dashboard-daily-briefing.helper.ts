import { DataDuration, type EventInterface, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { isTimelineNoteVisible, timelineNoteOverlaps, type TimelineNote } from '@shared/timeline-notes';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { formatActivityCalendarDateParam, resolveActivityCalendarPrimaryRange } from './activity-calendar.helper';
import { resolveCalendarCompletionCoverage, type CalendarPeriodSchedule, type CalendarPeriodSource } from './calendar-period-summary.helper';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import { buildDashboardGlanceSummary, type HealthChangeSignal } from './health-change-summary.helper';
import { getDateTimeFormatter } from './date-time-format.helper';
import { getNumberFormatter } from './number-format.helper';

export interface DashboardBriefingWindow {
  today: string;
  todayStartMs: number;
  tomorrowMs: number;
  weekStart: string;
  weekEnd: string;
  scheduleEnd: string;
}

export interface DashboardBriefingLoadComparison {
  direction: 'higher' | 'lower';
  utcDayMs: number;
}

/** A timestamp alone cannot select between two device/statistic sources. */
export function dashboardBriefingSleepDuration(
  points: readonly { endTimeMs: number; isNap?: boolean; isPlaceholder?: boolean; totalSeconds: number; providerLabel: string }[],
  selectedAtMs: number | null | undefined,
  unitSettings?: UserUnitSettingsInterface | null,
): string {
  const matching = points.filter(point => point.endTimeMs === selectedAtMs && !point.isNap && !point.isPlaceholder);
  if (matching.length !== 1 || !Number.isFinite(matching[0].totalSeconds) || matching[0].totalSeconds <= 0
    || !matching[0].providerLabel) return '';
  const duration = resolveUnitAwareDisplayFromValue(DataDuration.type, matching[0].totalSeconds, unitSettings)?.text;
  return duration ? `last night’s ${matching[0].providerLabel} sleep was ${duration}` : '';
}

/** Calendar labels are local dates, not UTC instants; preserve week preferences and DST. */
export function dashboardBriefingWindow(nowMs: number, startOfWeek?: number | null): DashboardBriefingWindow {
  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate() + 7);
  const week = resolveActivityCalendarPrimaryRange('week', today, startOfWeek);
  return { today: formatActivityCalendarDateParam(today), todayStartMs: today.getTime(), tomorrowMs: tomorrow.getTime(),
    weekStart: formatActivityCalendarDateParam(new Date(week.startMs)),
    weekEnd: formatActivityCalendarDateParam(new Date(week.endExclusiveMs - 1)),
    scheduleEnd: formatActivityCalendarDateParam(nextWeek) };
}

export interface DashboardBriefingContext {
  nowMs: number;
  window: DashboardBriefingWindow;
  signals: readonly HealthChangeSignal[];
  events: CalendarPeriodSource<readonly EventInterface[]>;
  schedule: CalendarPeriodSource<CalendarPeriodSchedule | null>;
  completions: CalendarPeriodSource<readonly TrainingWorkoutCompletionV1[]>;
  notes: readonly TimelineNote[];
  notesReady: boolean;
  recoveryText?: string;
  sleepText?: string;
  loadComparison?: DashboardBriefingLoadComparison | null;
  unitSettings?: UserUnitSettingsInterface | null;
  locale?: string;
}

/** User-authored titles remain quoted text, not instructions or prose templates. */
function title(value: string | null | undefined, limit = 48): string {
  const clean = Array.from(value || '').map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char).join('');
  const chars = Array.from(clean.replace(/\s+/g, ' ').trim());
  return chars.length ? `“${chars.slice(0, limit).join('')}${chars.length > limit ? '…' : ''}”` : 'an untitled workout';
}

/** Compose existing evidence, never infer completion from dates/names or prescribe training. */
export function buildDashboardDailyBriefing(input: DashboardBriefingContext): {
  headline: string; tone: 'neutral' | 'positive' | 'caution' | 'error';
} {
  const { window, schedule, completions, events } = input;
  const number = (value: number) => getNumberFormatter(input.locale).format(value);
  const clauses: string[] = [];
  const workouts = schedule.status === 'ready' ? (schedule.data?.workouts || []).filter(workout => workout.lifecycle !== 'deleted'
    && (workout.planId === null || workout.planId === schedule.data?.state.activePlanId)
    && workout.localDate >= window.weekStart && workout.localDate <= window.scheduleEnd) : [];
  const todayWorkouts = workouts.filter(workout => workout.localDate === window.today);
  const todayCoverage = resolveCalendarCompletionCoverage(todayWorkouts, completions);
  const todayLinked = new Set(todayCoverage.linkedWorkoutIds);
  const todayPlans = todayWorkouts.filter(workout => workout.lifecycle !== 'skipped' || todayLinked.has(workout.id));
  const recorded = new Map<string, EventInterface>();
  if (events.status === 'ready') for (const event of events.data) {
    const time = event.startDate?.getTime();
    if (time >= window.todayStartMs && time < window.tomorrowMs && time <= input.nowMs && event.getID()) recorded.set(event.getID(), event);
  }
  const todayParts: string[] = [];
  if (recorded.size) {
    const durationValues = [...recorded.values()].map(event => {
      const stat = event.getStat(DataDuration.type);
      return stat ? stat.getValue() : null;
    });
    const total = durationValues.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      ? durationValues.reduce((sum: number, value) => sum + (value as number), 0) : null;
    const duration = total !== null ? resolveUnitAwareDisplayFromValue(DataDuration.type, total, input.unitSettings)?.text : null;
    const name = recorded.size === 1 ? [...recorded.values()][0].name : null;
    todayParts.push(`${events.complete ? '' : 'at least '}${number(recorded.size)} ${recorded.size === 1 ? 'workout' : 'workouts'} recorded today${name ? `: ${title(name)}` : ''}${duration && events.complete ? ` (${duration})` : ''}`);
  }
  if (todayPlans.length) {
    const label = todayPlans.length === 1 ? title(todayPlans[0].title) : `${number(todayPlans.length)} workouts`;
    // Even an exact link may have been recorded early/late or against an older prescription.
    const allLinked = todayCoverage.complete && todayPlans.every(workout => todayLinked.has(workout.id));
    todayParts.push(`${label} on today’s plan${schedule.complete ? '' : ' (plan list may be incomplete)'}${allLinked ? ' with linked activity evidence' : ''}`);
  }
  if (todayParts.length) clauses.push(todayParts.join(', with '));

  const notes = input.notesReady ? input.notes.filter(note => isTimelineNoteVisible(note)
    && timelineNoteOverlaps(note, { startDate: window.today, endDate: window.today }, input.nowMs))
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id)) : [];
  if (notes.length) clauses.push(`active note: ${title(notes[0].title, 64)}${notes.length > 1 ? ` and ${number(notes.length - 1)} more` : ''}`);

  const assessment = buildDashboardGlanceSummary(input.signals);
  const issues = input.signals.filter(signal => signal.state === 'attention' || signal.state === 'outside-range');
  if (issues.length) clauses.push(issues.slice(0, 2).map(signal => signal.summaryText || `${signal.label}: ${signal.statusText}`).join(', and '));
  else if (input.signals.length && ['unavailable', 'insufficient', 'loading'].includes(assessment.state || '')) {
    clauses.push(assessment.headline.replace(/\.$/, ''));
  }

  // Reuse the Dashboard ACWR bands, but describe the comparison, not a risk or instruction.
  const now = new Date(input.nowMs);
  const utcDayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const comparison = input.loadComparison?.utcDayMs === utcDayMs ? input.loadComparison.direction : null;
  const load = comparison === 'higher' ? 'seven-day load is above your four-week weekly average'
    : comparison === 'lower' ? 'seven-day load is below your four-week weekly average' : '';
  // One malformed link must not suppress valid evidence in an unrelated calendar scope.
  const weekWorkouts = workouts.filter(workout => workout.localDate <= window.weekEnd);
  const weekCoverage = resolveCalendarCompletionCoverage(weekWorkouts, completions);
  const weekLinked = new Set(weekCoverage.linkedWorkoutIds);
  const weekPlans = weekWorkouts.filter(workout => workout.lifecycle !== 'skipped' || weekLinked.has(workout.id));
  const progress = schedule.complete && weekCoverage.complete && weekPlans.length
    ? `${number(weekPlans.filter(workout => weekLinked.has(workout.id)).length)} of ${number(weekPlans.length)} ${weekPlans.length === 1 ? 'workout scheduled this week has' : 'workouts scheduled this week have'} linked activities` : '';
  const upcoming = workouts.filter(workout => workout.localDate > window.today && workout.lifecycle !== 'skipped');
  const upcomingCoverage = resolveCalendarCompletionCoverage(upcoming, completions);
  const upcomingLinked = new Set(upcomingCoverage.linkedWorkoutIds);
  const next = schedule.complete && upcomingCoverage.complete ? upcoming.filter(workout => !upcomingLinked.has(workout.id))
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.id.localeCompare(b.id))[0] : null;
  const nextDate = next ? getDateTimeFormatter(input.locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${next.localDate}T12:00:00Z`)) : '';
  const nextClause = next && !todayPlans.length ? `next on your plan is ${title(next.title)} on ${nextDate}` : '';
  const recovery = input.recoveryText && input.recoveryText !== '--' ? `imported recovery remaining is ${input.recoveryText}` : '';
  const sleep = input.sleepText ? input.sleepText : '';
  for (const candidate of [load, progress, nextClause, recovery, sleep]) {
    if (candidate && clauses.length < 4 && clauses.join('; ').length + candidate.length <= 360) clauses.push(candidate);
  }
  let headline = clauses.length ? clauses.join('; ') : assessment.headline.replace(/\.$/, '');
  headline = headline.charAt(0).toUpperCase() + headline.slice(1) + '.';
  const tone = issues.length ? 'caution' : assessment.state === 'unavailable' ? 'error' : load ? 'caution'
    : assessment.state === 'available' || assessment.state === 'within-range' ? 'positive' : 'neutral';
  return { headline, tone };
}
