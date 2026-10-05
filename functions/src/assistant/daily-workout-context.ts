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

type HistoryMessage = Pick<AssistantMessage, 'role' | 'text'> & Partial<Pick<AssistantMessage, 'createdAt'>>;
const DATE_WORD = '(?:today|tomorrow|tonight|this morning|this afternoon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\\d{4}-\\d{2}-\\d{2})';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WITHOUT_PLAN = /\b(?:if i (?:didn't|did not|didn’t) have|without) (?:that |the |my |a )?plan\b/iu;
const NO_MORE_TODAY = /\b(?:today (?:was|is) done|no (?:other|more|additional) (?:session|workout)|(?:done|finished) (?:for )?today)\b/iu;

function isPlanCreation(prompt: string): boolean {
  return /\b(?:create|build|make|add|schedule)\s+(?:me\s+)?(?:(?:a|an|one|new|my|the)\s+){0,3}(?:training\s+)?plan\b/iu.test(prompt);
}

function isRecommendation(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const workout = /\b(workout|session|ride|run|training|exercise)\b/u.test(normalized);
  const recommendation = /\b(suggest|recommend|propose|create|add|schedule|build|make|reassess|reconsider|should i|what should i)\b/u.test(normalized);
  return workout && recommendation && new RegExp(`\\b${DATE_WORD}\\b`, 'iu').test(prompt);
}

function isRecommendationFollowUp(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return /\b(reassess|reconsider|check again|all (?:of )?the above)\b/u.test(normalized)
    || new RegExp(`\\b(?:what about|for)\\s+${DATE_WORD}\\b`, 'iu').test(prompt)
    || /\b(?:if i (?:didn't|did not|didn’t) have|without) (?:that |the |my |a )?plan\b/u.test(normalized)
    || (/\bwhat about\b/u.test(normalized)
      && /\b(workout|session|ride|run|training|exercise|form|ramp|completion|plan)\b/u.test(normalized));
}

/** Follow an uninterrupted recommendation thread, never inheriting authority for an earlier write. */
export function requestsDailyWorkoutContext(prompt: string, history: readonly HistoryMessage[]): boolean {
  if (isPlanCreation(prompt)) return false;
  if (isRecommendation(prompt)) return true;
  if (!isRecommendationFollowUp(prompt)) return false;
  const users = history.filter(message => message.role === 'user');
  for (let index = users.length - 1; index >= 0; index -= 1) {
    if (isPlanCreation(users[index].text)) return false;
    if (isRecommendation(users[index].text)) return true;
    if (!isRecommendationFollowUp(users[index].text)) return false;
  }
  return false;
}

export interface DailyWorkoutRequest {
  targetDate: string | null;
  hypotheticalWithoutPlan: boolean;
  noAdditionalWorkoutToday: boolean;
}

function requestedDate(prompt: string, anchorDate: string): string | null | undefined {
  const datePrompt = prompt.replace(/\btoday (?:was|is) done\b/giu, '')
    .replace(/\b(?:done|finished) (?:for )?today\b/giu, '');
  // Prefer the requested session's date over contextual mentions such as “today was done”.
  const directed = [...datePrompt.matchAll(new RegExp(`\\b(?:for|on|about|and|or)\\s+(?:next\\s+)?(${DATE_WORD})\\b`, 'giu'))];
  const mentions = directed.length ? directed
    : [...datePrompt.matchAll(new RegExp(`\\b(${DATE_WORD})\\b`, 'giu'))];
  if (!mentions.length) return undefined;
  const dates = mentions.map(match => {
    const value = match[1].toLowerCase();
    if (value === 'tomorrow') return dayOffset(anchorDate, 1);
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      const ms = Date.parse(`${value}T00:00:00.000Z`);
      return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null;
    }
    const weekday = WEEKDAYS.findIndex(day => day.toLowerCase() === value);
    if (weekday >= 0) {
      const current = new Date(`${anchorDate}T00:00:00.000Z`).getUTCDay();
      const offset = (weekday - current + 7) % 7;
      return dayOffset(anchorDate, /\bnext\b/iu.test(prompt) && offset === 0 ? 7 : offset);
    }
    return anchorDate;
  });
  return new Set(dates).size === 1 ? dates[0] : null;
}

/** Relative dates in old turns stay anchored to those turns, including across midnight. */
export function resolveDailyWorkoutRequest(prompt: string, history: readonly HistoryMessage[],
  now: Date, timeZone: string): DailyWorkoutRequest {
  const currentDay = localCalendarDay(now, timeZone).date;
  let targetDate = requestedDate(prompt, currentDay);
  let hypotheticalWithoutPlan = WITHOUT_PLAN.test(prompt);
  let noAdditionalWorkoutToday = NO_MORE_TODAY.test(prompt);
  const continuation = isRecommendationFollowUp(prompt) && !isRecommendation(prompt);
  if (targetDate === undefined || continuation) {
    const users = history.filter(message => message.role === 'user');
    for (let index = users.length - 1; index >= 0; index -= 1) {
      const message = users[index];
      if (isPlanCreation(message.text) || (!isRecommendation(message.text) && !isRecommendationFollowUp(message.text))) break;
      const timestamp = message.createdAt ? new Date(message.createdAt) : now;
      if (!Number.isFinite(timestamp.getTime())) break;
      const messageDay = localCalendarDay(timestamp, timeZone).date;
      if (targetDate === undefined) targetDate = requestedDate(message.text, messageDay);
      if (continuation) {
        hypotheticalWithoutPlan ||= WITHOUT_PLAN.test(message.text);
        noAdditionalWorkoutToday ||= messageDay === currentDay && NO_MORE_TODAY.test(message.text);
      }
      if (targetDate !== undefined && (!continuation || isRecommendation(message.text))) break;
    }
  }
  return {
    targetDate: targetDate ?? null,
    hypotheticalWithoutPlan,
    noAdditionalWorkoutToday,
  };
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
  recommendation?: DailyWorkoutRequest;
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
    scheduleRevision: number | null; workouts: RecordValue[]; completionChecked: boolean };
  trainingSnapshots: { preparationStatus: string; form: RecordValue | null;
    rampRate: RecordValue | null; trainingSummary: RecordValue | null };
}

export function canPreviewDailyWorkout(prompt: string, context: DailyWorkoutContext): boolean {
  const request = context.recommendation;
  return requestsDailyWorkoutChange(prompt) && (!request || (request.targetDate !== null
    && !request.hypotheticalWithoutPlan
    && !(request.noAdditionalWorkoutToday && request.targetDate === context.localDate)));
}

export async function collectDailyWorkoutContext(input: {
  now: Date;
  timeZone: string;
  timelineNotesEnabled: boolean;
  trainingPlansEnabled: boolean;
  read: ReadTool;
  request?: DailyWorkoutRequest;
}): Promise<DailyWorkoutContext> {
  const day = localCalendarDay(input.now, input.timeZone);
  const request = input.request ?? { targetDate: day.date, hypotheticalWithoutPlan: false,
    noAdditionalWorkoutToday: false };
  const targetWeekday = request.targetDate
    ? localCalendarDay(new Date(`${request.targetDate}T12:00:00.000Z`), 'UTC').weekday : day.weekday;
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
    localCalendarDay(new Date(`${date}T12:00:00.000Z`), 'UTC').weekday === targetWeekday);
  const activities = await input.read('query_activities', {
    relativePeriod: 'today', timeZone: input.timeZone, limit: 100,
  });

  const timelineNotes: DailyWorkoutContext['timelineNotes'] = {
    access: input.timelineNotesEnabled ? 'enabled' : 'disabled',
    scanComplete: input.timelineNotesEnabled ? false : null,
    notes: [],
  };
  if (input.timelineNotesEnabled) {
    const requestedEnd = request.targetDate && request.targetDate > day.date ? request.targetDate : day.date;
    // Keep the existing 366-day notes contract; a distant target is not a complete notes scan.
    const noteEndDate = requestedEnd > dayOffset(windowStartDate, 365)
      ? dayOffset(windowStartDate, 365) : requestedEnd;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_NOTE_PAGES; page += 1) {
      const result = await input.read('query_timeline_notes', {
        startDate: windowStartDate, endDate: noteEndDate, limit: NOTE_PAGE_LIMIT,
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
        status: typeof note.startDate === 'string' && note.startDate > day.date ? 'upcoming'
          : note.endDate === null || (typeof note.endDate === 'string' && note.endDate >= day.date)
            ? 'ongoing' : 'ended',
      })));
      timelineNotes.scanComplete = result.scanComplete === true && requestedEnd === noteEndDate;
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
      if (result.scanComplete === true || !cursor) break;
    }
  }

  const plannedWorkouts: DailyWorkoutContext['plannedWorkouts'] = {
    access: input.trainingPlansEnabled ? 'enabled' : 'disabled',
    scanComplete: input.trainingPlansEnabled ? false : null,
    scheduleRevision: null,
    workouts: [],
    completionChecked: false,
  };
  if (input.trainingPlansEnabled && request.targetDate) {
    const schedule = await input.read('query_planned_workouts_by_date', {
      startDate: request.targetDate, endDate: request.targetDate, limit: WORKOUT_LIMIT,
    });
    if (!Number.isSafeInteger(schedule.scheduleRevision)
      || Number(schedule.scheduleRevision) < 0) {
      throw new Error('The Assistant received an invalid Training schedule revision.');
    }
    plannedWorkouts.scheduleRevision = Number(schedule.scheduleRevision);
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
    recommendation: request,
    localDate: day.date,
    weekday: targetWeekday,
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
  const targetDate = context.recommendation ? context.recommendation.targetDate : context.localDate;
  if (!targetDate) facts.push('**Workout date:** Unclear; confirm one date before adding a session.');
  else if (targetDate !== context.localDate) {
    facts.push(`**Workout date:** ${targetDate}. Readiness and completed activities were checked as of ${context.localDate}, not forecast for the requested date.`);
  }
  if (context.recommendation?.hypotheticalWithoutPlan) {
    facts.push('**Without the plan:** This is a hypothetical suggestion; your actual schedule is unchanged.');
  }
  if (context.recommendation?.noAdditionalWorkoutToday) facts.push('**Your request:** No additional workout today.');
  const weekday = `${context.weekday}s`;
  if (targetDate) facts.push(`**Training pattern:** Workouts recorded on ${context.weekdayConsistency.matchingWeekdayCount} of the last ${context.weekdayConsistency.weekdayOpportunities} ${weekday}. Days without records are unknown.`);
  facts.push(context.activitiesToday.scanComplete
    ? `**Today:** ${context.activitiesToday.activities.length} recorded activities.`
    : `**Today:** Some activities could not be checked, so the total is unknown.`);
  if (context.timelineNotes.access === 'disabled') {
    facts.push('Timeline notes were not checked because access is off.');
  } else {
    const ended = context.timelineNotes.notes.filter(note => note.status === 'ended');
    const ongoing = context.timelineNotes.notes.filter(note => note.status === 'ongoing');
    const upcoming = context.timelineNotes.notes.filter(note => note.status === 'upcoming');
    facts.push(`**Timeline notes (${targetDate && targetDate > context.localDate ? 'recent and upcoming' : 'last 28 days'}):** Found ${ongoing.length} ongoing, ${ended.length} ended${upcoming.length ? `, ${upcoming.length} upcoming` : ''}.${context.timelineNotes.scanComplete ? '' : ' Some notes could not be checked; more may exist.'}`);
    for (const note of [...ongoing, ...upcoming, ...ended].slice(0, 3)) {
      const category = String(note.category).replace(/_/g, ' ');
      facts.push(`“${escapeMarkdownText(note.title)}” (${escapeMarkdownText(category)}): ${String(note.startDate)} – ${String(note.endDate ?? 'ongoing')}${note.endDate === null ? '' : ` (${String(note.status)})`}.`);
    }
  }
  if (context.plannedWorkouts.access === 'disabled') {
    facts.push('Planned workouts and linked activities were not checked because Training plans access is off.');
  } else if (targetDate) {
    const linked = context.plannedWorkouts.workouts.filter(workout =>
      asRecord(workout.completion)?.state === 'linked');
    const count = context.plannedWorkouts.workouts.length;
    const planned = count === 0
      ? `No workouts ${context.plannedWorkouts.scanComplete ? `listed for ${targetDate === context.localDate ? 'today' : targetDate}` : 'found so far'}.`
      : `${count} workout${count === 1 ? '' : 's'}; ${linked.length} ${linked.length === 1 ? 'has a' : 'have a'} linked recorded activity.`;
    facts.push(`**Planned ${targetDate === context.localDate ? 'today' : targetDate}:** ${planned}${context.plannedWorkouts.scanComplete ? '' : ' Some planned workouts could not be checked; more may exist.'}`);
    for (const workout of linked.slice(0, 3)) {
      facts.push(`Linked to a recorded activity: “${escapeMarkdownText(workout.title)}”.`);
    }
  }
  const training = [
    { label: 'Freshness', available: context.trainingSnapshots.form !== null },
    { label: 'Ramp rate', available: context.trainingSnapshots.rampRate !== null },
    { label: 'Training summary', available: context.trainingSnapshots.trainingSummary !== null },
  ];
  const checked = training.filter(item => item.available).map(item => item.label).join(', ');
  const unavailable = training.filter(item => !item.available).map(item => item.label).join(', ');
  facts.push(`**Training data:** ${[checked && `${checked} checked.`, unavailable && `${unavailable} unavailable.`].filter(Boolean).join(' ')}`);
  return facts.map(fact => `- ${fact}`).join('\n');
}
