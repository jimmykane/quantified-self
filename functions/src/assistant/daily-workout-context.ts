import { DataDuration } from '@sports-alliance/sports-lib';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import type { AssistantMessage } from '../../../shared/assistant.types';
import type { AssistantMcpToolName } from './mcp-session';

type RecordValue = Record<string, unknown>;
type ReadTool = (name: AssistantMcpToolName, input: RecordValue) => Promise<RecordValue>;

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 28;
const NOTE_PAGE_LIMIT = 64;
const MAX_NOTE_PAGES = 2;
const WORKOUT_LIMIT = 25;

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : null;
}

function records(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.flatMap(item => {
    const record = asRecord(item);
    return record ? [record] : [];
  }) : [];
}

function localCalendarDay(now: Date, timeZone: string): { date: string; weekday: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
  }).formatToParts(now).map(part => [part.type, part.value]));
  if (!parts.year || !parts.month || !parts.day || !parts.weekday) {
    throw new Error('The Assistant could not resolve the current local calendar day.');
  }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday };
}

function dayOffset(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString().slice(0, 10);
}

function escapeMarkdownText(value: unknown): string {
  return String(value).replace(/[\r\n\t]/g, ' ').replace(/([\\`*_{}[\]()#+.!|>~-])/g, '\\$1');
}

/** A follow-up on a daily recommendation retains the same complete evidence path. */
export function requestsDailyWorkoutContext(prompt: string, history: readonly AssistantMessage[]): boolean {
  const normalized = prompt.toLowerCase();
  const workout = /\b(workout|session|ride|run|training|exercise)\b/u.test(normalized);
  const today = /\b(today|tonight|this morning|this afternoon)\b/u.test(normalized);
  const recommendation = /\b(suggest|recommend|propose|create|add|schedule|build|make|reassess|reconsider|should i|what should i)\b/u.test(normalized);
  if (workout && today && recommendation) return true;
  const reassessment = /\b(reassess|reconsider|check again)\b/u.test(normalized)
    || (/\bwhat about\b/u.test(normalized)
      && /\b(workout|session|ride|run|training|exercise|form|ramp|completion|plan)\b/u.test(normalized));
  if (!reassessment) return false;
  const latestUserMessage = [...history].reverse().find(message => message.role === 'user');
  return latestUserMessage !== undefined && requestsDailyWorkoutContext(latestUserMessage.text, []);
}

/** Suggestions remain read-only unless the current message expressly asks for a schedule or send proposal. */
export function requestsDailyWorkoutChange(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  if (/\b(?:read[ -]?only|do not|don't|without|no need to)\b[\s\S]{0,80}\b(?:create|preview|add|schedule|send|sync|save)\b/u.test(normalized)) {
    return false;
  }
  return /\b(?:create|add|schedule|save)\s+(?:it|this|that|one|a|an|the|my|me|workout|session|ride|run)\b/u.test(normalized)
    || /\b(?:send|sync)\s+(?:it|this|that|one|a|an|the|my|workout|session|ride|run|to|with)\b/u.test(normalized);
}

export interface DailyWorkoutContext {
  localDate: string;
  weekday: string;
  windowStartDate: string;
  dailyReport: RecordValue;
  weekdayConsistency: {
    recordedDates: string[];
    matchingWeekdayDates: string[];
    matchingWeekdayCount: number;
    weekdayOpportunities: number;
    missingBucketsAreUnknown: true;
  };
  activitiesToday: { scanComplete: boolean; activities: RecordValue[] };
  timelineNotes: { access: 'enabled' | 'disabled'; scanComplete: boolean | null;
    notes: RecordValue[] };
  plannedWorkouts: { access: 'enabled' | 'disabled'; scanComplete: boolean | null;
    workouts: RecordValue[]; completionChecked: boolean };
  trainingSnapshots: { preparationStatus: string; form: RecordValue | null;
    rampRate: RecordValue | null; trainingSummary: RecordValue | null };
}

export async function collectDailyWorkoutContext(input: {
  now: Date;
  timeZone: string;
  timelineNotesEnabled: boolean;
  trainingPlansEnabled: boolean;
  read: ReadTool;
}): Promise<DailyWorkoutContext> {
  const day = localCalendarDay(input.now, input.timeZone);
  const windowStartDate = dayOffset(day.date, -(LOOKBACK_DAYS - 1));
  // One extra UTC day includes the entire first local day in every IANA zone.
  const durationStart = new Date(Date.parse(`${windowStartDate}T00:00:00.000Z`) - DAY_MS).toISOString();
  const preparation = await input.read('prepare_training_metrics', {
    metricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.FormNow,
      DERIVED_METRIC_KINDS.RampRate, DERIVED_METRIC_KINDS.TrainingSummary],
  });
  const readyKinds = new Set(Array.isArray(preparation.readyMetricKinds)
    ? preparation.readyMetricKinds : []);
  const form = readyKinds.has(DERIVED_METRIC_KINDS.Form)
    ? await input.read('get_training_metric', { metricKind: DERIVED_METRIC_KINDS.Form }) : null;
  const rampRate = readyKinds.has(DERIVED_METRIC_KINDS.RampRate)
    ? await input.read('get_training_metric', { metricKind: DERIVED_METRIC_KINDS.RampRate }) : null;
  const trainingSummary = readyKinds.has(DERIVED_METRIC_KINDS.TrainingSummary)
    ? await input.read('get_training_metric', { metricKind: DERIVED_METRIC_KINDS.TrainingSummary }) : null;
  const dailyReport = await input.read('get_daily_report', { timeZone: input.timeZone });
  const duration = await input.read('query_metric', {
    metric: DataDuration.type,
    start: durationStart,
    end: input.now.toISOString(),
    aggregation: 'total',
    groupBy: 'date',
    interval: 'daily',
    timeZone: input.timeZone,
  });
  const recordedDates = [...new Set(records(asRecord(duration.aggregation)?.buckets)
    .filter(bucket => typeof bucket.aggregateValue === 'number' && bucket.aggregateValue > 0
      && typeof bucket.localDate === 'string' && bucket.localDate >= windowStartDate
      && bucket.localDate <= day.date)
    .map(bucket => bucket.localDate as string))].sort();
  const matchingWeekdayDates = recordedDates.filter(date =>
    localCalendarDay(new Date(`${date}T12:00:00.000Z`), 'UTC').weekday === day.weekday);
  const activities = await input.read('query_activities', {
    relativePeriod: 'today', timeZone: input.timeZone, limit: 100,
  });

  const timelineNotes: DailyWorkoutContext['timelineNotes'] = {
    access: input.timelineNotesEnabled ? 'enabled' : 'disabled',
    scanComplete: input.timelineNotesEnabled ? false : null,
    notes: [],
  };
  if (input.timelineNotesEnabled) {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_NOTE_PAGES; page += 1) {
      const result = await input.read('query_timeline_notes', {
        startDate: windowStartDate, endDate: day.date, limit: NOTE_PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      });
      timelineNotes.notes.push(...records(result.notes).map(note => ({
        category: note.category,
        title: note.title,
        details: typeof note.details === 'string' ? note.details.slice(0, 500) : null,
        startDate: note.startDate,
        endDate: note.endDate,
        effectiveEndDate: note.effectiveEndDate,
        timeZone: note.timeZone,
        status: note.endDate === null || (typeof note.endDate === 'string' && note.endDate >= day.date)
          ? 'ongoing' : 'ended',
      })));
      timelineNotes.scanComplete = result.scanComplete === true;
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
      if (timelineNotes.scanComplete || !cursor) break;
    }
  }

  const plannedWorkouts: DailyWorkoutContext['plannedWorkouts'] = {
    access: input.trainingPlansEnabled ? 'enabled' : 'disabled',
    scanComplete: input.trainingPlansEnabled ? false : null,
    workouts: [],
    completionChecked: false,
  };
  if (input.trainingPlansEnabled) {
    const schedule = await input.read('query_planned_workouts_by_date', {
      startDate: day.date, endDate: day.date, limit: WORKOUT_LIMIT,
    });
    plannedWorkouts.scanComplete = schedule.scanComplete === true;
    const workouts = records(schedule.workouts);
    const workoutRefs = workouts.map(workout => workout.workoutRef);
    if (workoutRefs.some(ref => typeof ref !== 'string')) {
      throw new Error('The Assistant received a planned workout without a reference.');
    }
    let completions: RecordValue[] = [];
    if (workoutRefs.length > 0) {
      const completionResult = await input.read('get_planned_workout_completions', {
        workoutRefs,
      });
      completions = records(completionResult.completions);
      if (completionResult.scheduleRevision !== schedule.scheduleRevision
        || completions.length !== workouts.length
        || completions.some((completion, index) => completion.workoutRef !== workoutRefs[index]
          || !['linked', 'unlinked'].includes(`${completion.state}`))) {
        throw new Error('The Assistant received incomplete planned workout completion evidence.');
      }
    }
    plannedWorkouts.workouts = workouts.map((workout, index) => ({
      title: workout.title,
      localDate: workout.localDate,
      lifecycle: workout.lifecycle,
      planRef: workout.planRef,
      workoutRef: workout.workoutRef,
      completion: completions[index] ?? null,
    }));
    plannedWorkouts.completionChecked = true;
  }

  return {
    localDate: day.date,
    weekday: day.weekday,
    windowStartDate,
    dailyReport,
    weekdayConsistency: {
      recordedDates,
      matchingWeekdayDates,
      matchingWeekdayCount: matchingWeekdayDates.length,
      weekdayOpportunities: 4,
      missingBucketsAreUnknown: true,
    },
    activitiesToday: {
      scanComplete: activities.scanComplete === true,
      activities: records(activities.activities),
    },
    timelineNotes,
    plannedWorkouts,
    trainingSnapshots: {
      preparationStatus: typeof preparation.status === 'string' ? preparation.status : 'unknown',
      form,
      rampRate,
      trainingSummary,
    },
  };
}

/** Server-authored facts are rendered even if the model omits a source. */
export function dailyWorkoutFacts(context: DailyWorkoutContext): string {
  const facts: string[] = [];
  const weekday = `${context.weekday}s`;
  facts.push(`${context.weekdayConsistency.matchingWeekdayCount} of the last ${context.weekdayConsistency.weekdayOpportunities} ${weekday} have recorded positive workout duration; missing days are unknown.`);
  facts.push(context.activitiesToday.scanComplete
    ? `${context.activitiesToday.activities.length} recorded activities today.`
    : `Today's activity scan was incomplete; the completed-activity count is unknown.`);
  if (context.timelineNotes.access === 'disabled') {
    facts.push('Timeline notes were not checked because access is off.');
  } else {
    const ended = context.timelineNotes.notes.filter(note => note.status === 'ended');
    const ongoing = context.timelineNotes.notes.filter(note => note.status === 'ongoing');
    facts.push(`${ongoing.length} ongoing and ${ended.length} ended Timeline notes found in the 28-day window${context.timelineNotes.scanComplete ? '.' : '; the scan was incomplete and more notes may exist.'}`);
    for (const note of [...ongoing, ...ended].slice(0, 3)) {
      facts.push(`${String(note.category)} note “${escapeMarkdownText(note.title)}”: ${String(note.startDate)}–${String(note.endDate ?? 'ongoing')} (${String(note.status)}).`);
    }
  }
  if (context.plannedWorkouts.access === 'disabled') {
    facts.push('Planned workouts and exact completion links were not checked because Training plans access is off.');
  } else {
    const linked = context.plannedWorkouts.workouts.filter(workout =>
      asRecord(workout.completion)?.state === 'linked');
    facts.push(`${context.plannedWorkouts.workouts.length} planned workout${context.plannedWorkouts.workouts.length === 1 ? '' : 's'} listed for today; ${linked.length} ${linked.length === 1 ? 'has an' : 'have'} exact stored completion link${linked.length === 1 ? '' : 's'}${context.plannedWorkouts.scanComplete ? '.' : '; the plan scan was incomplete and more workouts may exist.'}`);
    for (const workout of linked.slice(0, 3)) {
      facts.push(`Exact completion linked: “${escapeMarkdownText(workout.title)}”.`);
    }
  }
  facts.push(`Training Form snapshot ${context.trainingSnapshots.form ? 'read' : 'unavailable'}; ramp-rate snapshot ${context.trainingSnapshots.rampRate ? 'read' : 'unavailable'}; Training Summary snapshot ${context.trainingSnapshots.trainingSummary ? 'read' : 'unavailable'}.`);
  return facts.join(' ');
}
