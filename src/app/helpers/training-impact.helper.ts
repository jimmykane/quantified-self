import type { EventInterface } from '@sports-alliance/sports-lib';
import {
  buildTrainingSessionLoadImpact,
  resolveTrainingLoadDayImpact,
  type TrainingLoadDayImpact,
  type TrainingLoadPoint,
  type TrainingSessionLoadImpact,
} from '@shared/training-load';
import {
  resolveDashboardFormTrainingStressScore,
  type DashboardFormPoint,
} from './dashboard-form.helper';
import { isMergeOrBenchmarkEvent } from './event-visibility.helper';
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
  if (isMergeOrBenchmarkEvent(event)) {
    return unavailable('excluded', 'Merged benchmark events are excluded from Training.', eventId);
  }
  const dayMs = resolveTrainingImpactUtcDayMs(event);
  const trainingStressScore = resolveDashboardFormTrainingStressScore(event);
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
    message: '',
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
  const sessions = (events || []).map(event => buildTrainingSessionImpactView(event, source));
  const readySessions = sessions.filter((session): session is TrainingSessionImpactView & {
    impact: TrainingSessionLoadImpact;
  } => session.availability === 'ready' && session.impact !== null);
  const points = source.status === 'ready' ? toTrainingLoadPoints(source.formPoints) : [];
  const outcomes = source.status === 'ready'
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
  const unavailableSessionCount = sessions.length - readySessions.length;
  const availability = resolveDayAvailability(source, sessions, readySessions.length);
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
  if (sessions.some(session => session.availability === 'updating')) return 'updating';
  if (sessions.some(session => session.availability === 'error')) return 'error';
  return 'unavailable';
}

function dayAvailabilityMessage(
  availability: TrainingImpactAvailability,
  sessions: readonly TrainingSessionImpactView[],
): string {
  if (availability === 'ready') {
    return sessions.some(session => session.availability !== 'ready')
      ? 'Some completed activities have no available Training impact.'
      : '';
  }
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
