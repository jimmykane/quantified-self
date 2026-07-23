import type { DashboardFormPoint } from './dashboard-form.helper';
import {
  resolveDashboardFatigueAtlContext,
  resolveDashboardFitnessCtlContext,
  resolveDashboardFormNowContextFromPoints,
  resolveDashboardRampRateContextFromPoints,
  type DashboardFormNowContext,
  type DashboardFatigueAtlContext,
  type DashboardFitnessCtlContext,
  type DashboardRampRateContext,
} from './dashboard-derived-metrics.helper';
import {
  buildTrainingStateInfo,
  resolveTrainingStateClassification,
  type TrainingStateClassification,
  type TrainingStateInfo,
  type TrainingStateSignalInput,
} from './training-state.helper';

export interface CurrentTrainingStateInput {
  formPoints: readonly DashboardFormPoint[] | null | undefined;
  fallbackFormNow: DashboardFormNowContext | null | undefined;
  fallbackRampRate: DashboardRampRateContext | null | undefined;
  nowMs?: number;
}

export interface CurrentTrainingStateContext {
  formNow: DashboardFormNowContext | null;
  formNowFromSeries: DashboardFormNowContext | null;
  rampRate: DashboardRampRateContext | null;
  rampRateFromSeries: DashboardRampRateContext | null;
  fitness: DashboardFitnessCtlContext | null;
  fatigue: DashboardFatigueAtlContext | null;
  signals: TrainingStateSignalInput;
  state: TrainingStateClassification;
  info: TrainingStateInfo;
}

/**
 * Resolves the one TSS-only state shared by Training and Dashboard Today.
 * Form points take priority because they decay through the current UTC day;
 * compact Form/Ramp snapshots remain safe fallbacks while that series is absent.
 */
export function buildCurrentTrainingStateContext({
  formPoints,
  fallbackFormNow,
  fallbackRampRate,
  nowMs = Date.now(),
}: CurrentTrainingStateInput): CurrentTrainingStateContext {
  const formNowFromSeries = resolveDashboardFormNowContextFromPoints(formPoints, nowMs);
  const rampRateFromSeries = resolveDashboardRampRateContextFromPoints(formPoints, nowMs);
  const formNow = formNowFromSeries
    || fallbackFormNow
    || null;
  const rampRate = rampRateFromSeries
    || fallbackRampRate
    || null;
  const fitness = resolveDashboardFitnessCtlContext(formPoints, nowMs);
  const fatigue = resolveDashboardFatigueAtlContext(formPoints, nowMs);
  const signals: TrainingStateSignalInput = {
    form: formNow?.value ?? null,
    rampRate: rampRate?.rampRate ?? null,
    fitness: fitness?.value ?? null,
    fatigue: fatigue?.value ?? null,
  };

  return {
    formNow,
    formNowFromSeries,
    rampRate,
    rampRateFromSeries,
    fitness,
    fatigue,
    signals,
    state: resolveTrainingStateClassification(signals),
    info: buildTrainingStateInfo(signals),
  };
}
