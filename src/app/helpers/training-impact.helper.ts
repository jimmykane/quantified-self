import { resolveEffectiveTrainingLoad } from '@shared/training-load-policy';
import type { EventInterface } from '@sports-alliance/sports-lib';
import {
  buildTrainingSessionLoadImpact,
  isTrainingLoadWithinTotal,
  resolveTrainingLoadDayImpact,
  type TrainingLoadDayImpact,
  type TrainingLoadPoint,
  type TrainingSessionLoadImpact,
} from '@shared/training-load';
import {
  type DashboardFormPoint,
} from './dashboard-form.helper';
import { isBenchmarkEventForTrainingMetrics } from '@shared/event-classification';
import type { TrainingImpactSnapshotState } from '../services/training-impact.service';

export type TrainingImpactAvailability =
  | 'ready'
  | 'updating'
  | 'error'
  | 'private'
  | 'missing-tss'
  | 'excluded'
  | 'unavailable';

export interface TrainingSessionImpactView {
  availability: TrainingImpactAvailability;
  message: string;
  headline: string | null;
  eventId: string | null;
  dayMs: number | null;
  impact: TrainingSessionLoadImpact | null;
}

export interface TrainingDayImpactView {
  availability: TrainingImpactAvailability;
  message: string;
  headline: string | null;
  sessions: TrainingSessionImpactView[];
  trainingStressScore: number;
  ctlContribution: number;
  atlContribution: number;
  formContribution: number;
  outcomes: TrainingLoadDayImpact[];
  unavailableSessionCount: number;
}

export function resolveTrainingImpactUtcDayMs(event: EventInterface): number | null {
  const startDate = (event as { startDate?: unknown } | null)?.startDate;
  if (!(startDate instanceof Date) || !Number.isFinite(startDate.getTime())) {
    return null;
  }
  return Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
}

export function buildTrainingSessionImpactView(
  event: EventInterface,
  source: TrainingImpactSnapshotState,
): TrainingSessionImpactView {
  const eventId = `${event?.getID?.() || ''}`.trim() || null;
  if (isBenchmarkEventForTrainingMetrics(event)) {
    return unavailable('excluded', 'Merged benchmark events are excluded from Training.', eventId);
  }
  const dayMs = resolveTrainingImpactUtcDayMs(event);
  const modeled = eventId ? source.loadsByEventId?.get(eventId) : undefined;
  // Navigation can retain the previous selection's snapshot while new load reads start.
  if (eventId && source.status === 'ready' && source.loadsByEventId && !modeled)
    return unavailable('updating', 'Updating Training impact…', eventId, dayMs);
  if (modeled?.status === 'excluded') return unavailable('excluded', 'Excluded from modeled Training load. History and volume are retained.', eventId, dayMs);
  if (modeled?.reasons.includes('source-updating')) return unavailable('updating', 'Updating Training impact…', eventId, dayMs);
  if (modeled?.reasons.includes('activity-match-needs-review')) return unavailable('unavailable',
    'Review unmatched legs in Training load before using this workout’s modeled load.', eventId, dayMs);
  const trainingStressScore = modeled ? modeled.score : resolveEffectiveTrainingLoad(event).score;
  if (trainingStressScore === null) {
    return unavailable('missing-tss', 'Training impact unavailable — this activity has no TSS.', eventId, dayMs);
  }
  if (source.status !== 'ready') {
    const message = source.status === 'error'
      ? 'Training impact could not be loaded.'
      : source.status === 'private'
        ? 'Training impact is private.'
        : 'Updating Training impact…';
    return unavailable(source.status, message, eventId, dayMs);
  }
  if (dayMs === null) {
    return unavailable('unavailable', 'Training impact unavailable — this activity has no valid start time.', eventId);
  }
  const points = toTrainingLoadPoints(source.formPoints);
  const day = resolveTrainingLoadDayImpact(points, dayMs);
  if (!day) {
    return unavailable('unavailable', 'Training impact is not available for this Training day.', eventId, dayMs);
  }
  const impact = buildTrainingSessionLoadImpact(trainingStressScore, day);
  if (!impact) {
    return unavailable('updating', 'Updating Training impact…', eventId, dayMs);
  }
  return {
    availability: 'ready',
    message: modeled?.status === 'partial' ? 'This contribution uses available legs only. Some included legs have no usable load.' : '',
    headline: sessionRoleHeadline(impact),
    eventId,
    dayMs,
    impact,
  };
}

export function buildTrainingDayImpactView(
  events: readonly EventInterface[] | null | undefined,
  source: TrainingImpactSnapshotState,
): TrainingDayImpactView {
  const sessionViews = (events || []).map(event => buildTrainingSessionImpactView(event, source));
  // A pending selected load can change the shared Form outcome, even when another
  // session already has a usable score. Missing load may be partial; pending load must wait.
  const awaitingLoads = source.status === 'ready' && (sessionViews.some(session => session.availability === 'updating')
    || selectedLoadsExceedForm(sessionViews));
  const daySource: TrainingImpactSnapshotState = awaitingLoads ? { ...source, status: 'updating', formPoints: null } : source;
  const sessions = awaitingLoads ? sessionViews.map(session => session.availability === 'ready'
    ? unavailable('updating', 'Updating Training impact…', session.eventId, session.dayMs) : session) : sessionViews;
  const readySessions = sessions.filter((session): session is TrainingSessionImpactView & {
    impact: TrainingSessionLoadImpact;
  } => session.availability === 'ready' && session.impact !== null);
  const points = daySource.status === 'ready' ? toTrainingLoadPoints(daySource.formPoints) : [];
  const outcomes = daySource.status === 'ready'
    ? [...new Set(sessions.flatMap(session => (
      session.availability !== 'excluded' && session.dayMs !== null ? [session.dayMs] : []
    )))]
      .map(dayMs => resolveTrainingLoadDayImpact(points, dayMs))
      .filter((outcome): outcome is TrainingLoadDayImpact => outcome !== null)
      .sort((left, right) => left.dayMs - right.dayMs)
    : [];
  const totals = readySessions.reduce((total, session) => ({
    trainingStressScore: total.trainingStressScore + session.impact.trainingStressScore,
    ctlContribution: total.ctlContribution + session.impact.ctlContribution,
    atlContribution: total.atlContribution + session.impact.atlContribution,
    formContribution: total.formContribution + session.impact.formContribution,
  }), { trainingStressScore: 0, ctlContribution: 0, atlContribution: 0, formContribution: 0 });
  const unavailableSessionCount = sessions.filter(session => session.availability !== 'ready' && session.availability !== 'excluded').length;
  const availability = resolveDayAvailability(daySource, sessions, readySessions.length);
  return {
    availability,
    message: dayAvailabilityMessage(availability, sessions),
    headline: availability === 'ready' ? dayHeadline(outcomes) : null,
    sessions,
    ...totals,
    outcomes,
    unavailableSessionCount,
  };
}

function selectedLoadsExceedForm(sessions: readonly TrainingSessionImpactView[]): boolean {
  const days = new Map<number, { selected: number; saved: number; count: number }>();
  for (const { impact } of sessions) {
    if (!impact) continue;
    const total = days.get(impact.day.dayMs) ?? { selected: 0, saved: impact.day.trainingStressScore, count: 0 };
    total.selected += impact.trainingStressScore;
    total.count++;
    days.set(impact.day.dayMs, total);
  }
  return [...days.values()].some(({ selected, saved, count }) => !isTrainingLoadWithinTotal(selected, saved, count));
}

export function sessionRoleHeadline(impact: TrainingSessionLoadImpact): string {
  switch (impact.role) {
    case 'pushed-above-maintenance': return 'Helped push the day above maintenance';
    case 'added-to-building-day': return 'Added to a fitness-building day';
    case 'offset-fitness-decay': return 'Offset normal fitness-load decay';
    case 'no-load': return 'No modeled load contribution';
  }
}

export function trainingDayOutcomeHeadline(day: TrainingLoadDayImpact): string {
  switch (day.outcome) {
    case 'raised': return 'Fitness load rose after normal decay';
    case 'held': return 'Fitness load held steady';
    case 'declined': return 'Fitness load declined after normal decay';
  }
}

function toTrainingLoadPoints(points: readonly DashboardFormPoint[] | null): TrainingLoadPoint[] {
  return (points || []).map(point => ({
    dayMs: point.time,
    load: point.trainingStressScore,
    ctl: point.ctl,
    atl: point.atl,
    formSameDay: point.formSameDay,
    formPriorDay: point.formPriorDay,
  }));
}

function unavailable(
  availability: Exclude<TrainingImpactAvailability, 'ready'>,
  message: string,
  eventId: string | null,
  dayMs: number | null = null,
): TrainingSessionImpactView {
  return { availability, message, headline: null, eventId, dayMs, impact: null };
}

function resolveDayAvailability(
  source: TrainingImpactSnapshotState,
  sessions: readonly TrainingSessionImpactView[],
  readySessionCount: number,
): TrainingImpactAvailability {
  if (source.status !== 'ready') return source.status;
  if (readySessionCount > 0) return 'ready';
  if (sessions.length && sessions.every(session => session.availability === 'excluded')) return 'excluded';
  if (sessions.some(session => session.availability === 'updating')) return 'updating';
  if (sessions.some(session => session.availability === 'error')) return 'error';
  return 'unavailable';
}

function dayAvailabilityMessage(
  availability: TrainingImpactAvailability,
  sessions: readonly TrainingSessionImpactView[],
): string {
  if (availability === 'ready') {
    if (sessions.some(session => session.availability !== 'ready' && session.availability !== 'excluded'))
      return 'Some completed activities have no available Training impact.';
    if (sessions.some(session => session.message && session.availability === 'ready'))
      return 'This total uses available legs only. Some included legs have no usable load.';
    return sessions.some(session => session.availability === 'excluded') ? 'Excluded activities do not contribute to modeled load.' : '';
  }
  if (availability === 'excluded') return 'Selected activities are excluded from modeled Training load. History and volume are retained.';
  if (availability === 'updating') return 'Updating Training impact…';
  if (availability === 'error') return 'Training impact could not be loaded.';
  if (availability === 'private') return 'Training impact is private.';
  return sessions.length
    ? 'Training impact unavailable — no completed activity has usable TSS.'
    : 'No completed activities for this day.';
}

function dayHeadline(outcomes: readonly TrainingLoadDayImpact[]): string {
  if (outcomes.length > 1) return `Activities span ${outcomes.length} UTC Training days`;
  return outcomes[0] ? trainingDayOutcomeHeadline(outcomes[0]) : 'No modeled load contribution';
}
