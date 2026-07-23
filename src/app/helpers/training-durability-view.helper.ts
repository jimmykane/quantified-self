import type {
  DerivedTrainingDurabilityContext,
  DerivedTrainingDurabilityContextSummary,
  DerivedTrainingDurabilityMetricPayload,
  DerivedTrainingDurabilityScope,
  TrainingVisibleDiscipline,
} from '@shared/derived-metrics';
import { formatSleepDuration } from './dashboard-sleep-chart.helper';

export type TrainingDurabilityDeltaTone = 'positive' | 'negative' | 'neutral';
export interface TrainingDurabilityMetricViewModel {
  label: string;
  currentText: string;
  usualText: string;
  deltaText: string;
  deltaTone: TrainingDurabilityDeltaTone;
  detailText: string;
}
export interface TrainingDurabilityTrajectoryPointViewModel {
  weekStartDayMs: number;
  weekEndDayMs: number;
  value: number | null;
  candidateActivityCount: number;
  sourceActivityCount: number;
  eligibleSampleCount: number;
  exclusionReasons: TrainingDurabilityExclusionViewModel[];
  hasEligibleSamples: boolean;
}
export interface TrainingDurabilityExclusionViewModel {
  reason: string;
  label: string;
  activityCount: number;
}
export interface TrainingDurabilityTrajectoryViewModel {
  contextKey: string;
  contextLabel: string;
  title: string;
  metricLabel: string;
  metricDescription: string;
  eligibilityDescription: string;
  sourceActivityLabel: string;
  barExplanation: string;
  activityCountSummary: string;
  exclusionSummary: string | null;
  unitLabel: '%';
  noEligibleWeekCount: number;
  unavailableMetricWeekCount: number;
  points: TrainingDurabilityTrajectoryPointViewModel[];
}
export interface TrainingDurabilityContextViewModel {
  contextKey: string;
  label: string;
  sampleText: string;
  metrics: TrainingDurabilityMetricViewModel[];
  trajectory: TrainingDurabilityTrajectoryViewModel;
}
export interface TrainingDurabilityScopeViewModel {
  scope: DerivedTrainingDurabilityScope;
  label: string;
  conclusionText: string;
  evidenceQualityText: string;
  nextStepText: string | null;
  evidenceText: string;
  coverageText: string;
  exclusionText: string | null;
  contexts: TrainingDurabilityContextViewModel[];
  trendText: string;
  supportingEventsText: string | null;
}

export function buildTrainingDurabilityScopeViewModels(
  payload: DerivedTrainingDurabilityMetricPayload | null | undefined,
  visibleDisciplines: readonly TrainingVisibleDiscipline[],
): TrainingDurabilityScopeViewModel[] {
  if (!payload) return [];
  const visibleScopes = resolveVisibleScopes(visibleDisciplines);
  return payload.scopes.filter(item => visibleScopes.has(item.scope)).map((item) => {
    const currentByContext = new Map(item.current.summaries.map(summary => [summary.context.contextKey, summary]));
    const usualByContext = new Map(item.usual.summaries.map(summary => [summary.context.contextKey, summary]));
    const contextsByKey = new Map<string, DerivedTrainingDurabilityContext>();
    [
      ...item.current.summaries,
      ...item.usual.summaries,
      ...item.weeks.flatMap(week => week.summaries),
    ].forEach(summary => contextsByKey.set(summary.context.contextKey, summary.context));
    const contexts = [...contextsByKey.values()]
      .sort((left, right) => left.contextKey.localeCompare(right.contextKey))
      .map(context => buildContextViewModel(
        context,
        currentByContext.get(context.contextKey) || null,
        usualByContext.get(context.contextKey) || null,
        item.weeks,
      ));
    const eligibleWeeks = item.weeks.filter(week => week.coverage.eligibleActivityCount > 0).length;
    const supportingLabels = item.recentSupportingEvents.slice(0, 3).map(event => event.label || 'Unlabelled activity');
    const exclusions = item.current.coverage.exclusions
      .filter(exclusion => exclusion.activityCount > 0)
      .sort((left, right) => right.activityCount - left.activityCount || left.reason.localeCompare(right.reason));
    const currentPowerActivityCount = item.scope === 'cycling'
      ? resolvePowerActivityCount(item.current.coverage)
      : null;
    const candidateCount = item.current.coverage.candidateActivityCount;
    const eligibleCount = item.current.coverage.eligibleActivityCount;
    return {
      scope: item.scope,
      label: formatScopeLabel(item.scope),
      conclusionText: buildScopeConclusion(candidateCount, eligibleCount),
      evidenceQualityText: buildEvidenceQualityText(candidateCount, eligibleCount),
      nextStepText: eligibleCount === 0 && exclusions.length
        ? 'Look at the primary exclusions to see which data or comparability condition prevented a reading.'
        : eligibleCount > 0 && eligibleWeeks < 2
          ? 'Use the twelve-week trail to see how often comparable evidence is available.'
          : null,
      evidenceText: currentPowerActivityCount === null
        ? `${eligibleCount} eligible of ${candidateCount} candidate workouts`
        : `${eligibleCount} eligible · ${currentPowerActivityCount} with power · ${candidateCount} candidates`,
      coverageText: item.current.coverage.eligibilityRatio === null
        ? 'Eligibility ratio unavailable'
        : `${formatPercent(item.current.coverage.eligibilityRatio * 100)} eligible`,
      exclusionText: exclusions.length
        ? `Primary exclusions: ${exclusions.map(exclusion => `${formatExclusionReason(exclusion.reason, item.scope === 'cycling')} ${exclusion.activityCount}`).join(' · ')}`
        : null,
      contexts,
      trendText: `${eligibleWeeks} of 12 recent weeks produced comparable workout evidence`,
      supportingEventsText: supportingLabels.length ? `Recent supporting workouts: ${supportingLabels.join(' · ')}` : null,
    };
  });
}

function buildScopeConclusion(candidateCount: number, eligibleCount: number): string {
  if (candidateCount === 0) {
    return 'No recent workouts can be checked for durability in this sport yet.';
  }
  if (eligibleCount === 0) {
    return 'No current workout met the steady-effort comparison rules, so durability is not being judged.';
  }
  return `Durability is based on ${eligibleCount} comparable current ${eligibleCount === 1 ? 'workout' : 'workouts'}; read it as a directional signal rather than a verdict.`;
}

function buildEvidenceQualityText(candidateCount: number, eligibleCount: number): string {
  if (candidateCount === 0) {
    return 'Evidence quality: unavailable — no candidate workouts in the current window.';
  }
  const ratio = eligibleCount / candidateCount;
  const quality = ratio >= 0.5 ? 'usable' : 'limited';
  return `Evidence quality: ${quality} — ${eligibleCount} of ${candidateCount} candidate ${candidateCount === 1 ? 'workout met' : 'workouts met'} the comparison rules.`;
}

function buildContextViewModel(
  context: DerivedTrainingDurabilityContext,
  current: DerivedTrainingDurabilityContextSummary | null,
  usual: DerivedTrainingDurabilityContextSummary | null,
  weeks: DerivedTrainingDurabilityMetricPayload['scopes'][number]['weeks'],
): TrainingDurabilityContextViewModel {
  const metrics: TrainingDurabilityMetricViewModel[] = [];
  addMetric(metrics, 'Aerobic decoupling', current?.medianDecouplingPercent ?? null, usual?.medianDecouplingPercent, '%', 'absolute-inverse', 'Smaller absolute drift is steadier.');
  addMetric(metrics, 'Output retained', current?.medianOutputRetentionPercent ?? null, usual?.medianOutputRetentionPercent, '%', 'direct', 'Second-half output relative to the first half.');
  addMetric(metrics, 'Heart-rate drift', current?.medianHeartRateDriftBpm ?? null, usual?.medianHeartRateDriftBpm, ' bpm', 'absolute-inverse', 'Smaller absolute drift at comparable output is steadier.');
  addMetric(metrics, 'Pool pace retained', current?.medianPaceRetentionPercent ?? null, usual?.medianPaceRetentionPercent, '%', 'direct', 'Final comparable lengths relative to the first comparable lengths.');
  addMetric(metrics, 'SWOLF change', current?.medianSwolfChange ?? null, usual?.medianSwolfChange, '', 'inverse', 'Final comparable lengths versus the first; lower is steadier.');
  return {
    contextKey: context.contextKey,
    label: formatContextLabel(context),
    sampleText: current
      ? `${current.sampleCount} comparable ${current.sampleCount === 1 ? 'workout' : 'workouts'}${current.medianDurationSeconds === null ? '' : ` · median ${formatSleepDuration(current.medianDurationSeconds)}`}${current.medianCoverageRatio === null ? '' : ` · ${formatPercent(current.medianCoverageRatio * 100)} paired data`}`
      : 'No current comparable workouts',
    metrics,
    trajectory: buildTrajectoryViewModel(context, weeks),
  };
}

function addMetric(
  metrics: TrainingDurabilityMetricViewModel[],
  label: string,
  current: number | null,
  usual: number | null | undefined,
  suffix: string,
  direction: 'direct' | 'inverse' | 'absolute-inverse',
  detailText: string,
): void {
  if (current === null && (usual === null || usual === undefined)) return;
  const delta = current !== null && usual !== null && usual !== undefined ? current - usual : null;
  const semanticDelta = delta === null
    ? null
    : direction === 'absolute-inverse'
      ? Math.abs(current as number) - Math.abs(usual as number)
      : delta;
  const tone = semanticDelta === null || Math.abs(semanticDelta) < 0.05
    ? 'neutral'
    : ((direction === 'direct' ? semanticDelta > 0 : semanticDelta < 0) ? 'positive' : 'negative');
  metrics.push({
    label,
    currentText: formatMetric(current, suffix),
    usualText: formatMetric(usual ?? null, suffix),
    deltaText: delta === null ? '—' : Math.abs(delta) < 0.05 ? 'Same' : `${delta > 0 ? '+' : '−'}${formatMetric(Math.abs(delta), suffix)}`,
    deltaTone: tone,
    detailText,
  });
}

function buildTrajectoryViewModel(
  context: DerivedTrainingDurabilityContext,
  weeks: DerivedTrainingDurabilityMetricPayload['scopes'][number]['weeks'],
): TrainingDurabilityTrajectoryViewModel {
  const isPool = context.scope === 'pool-swimming';
  const isPower = context.outputSource === 'power';
  const sourceActivityLabel = isPower ? 'Power recorded' : 'Candidates';
  const points = [...weeks]
    .sort((left, right) => left.windowStartDayMs - right.windowStartDayMs)
    .map((week) => {
      const summary = week.summaries.find(item => item.context.contextKey === context.contextKey) || null;
      const exclusionReasons = week.coverage.exclusions
        .filter(exclusion => exclusion.activityCount > 0)
        .map(exclusion => ({
          reason: exclusion.reason,
          label: formatExclusionReason(exclusion.reason, isPower),
          activityCount: exclusion.activityCount,
        }));
      return {
        weekStartDayMs: week.windowStartDayMs,
        weekEndDayMs: week.windowEndDayMs,
        value: isPool
          ? summary?.medianPaceRetentionPercent ?? null
          : summary?.medianDecouplingPercent ?? null,
        candidateActivityCount: week.coverage.candidateActivityCount,
        sourceActivityCount: isPower
          ? resolvePowerActivityCount(week.coverage)
          : week.coverage.candidateActivityCount,
        eligibleSampleCount: summary?.sampleCount ?? 0,
        exclusionReasons,
        hasEligibleSamples: !!summary && summary.sampleCount > 0,
      };
    });
  const totalCandidates = sumPointCount(points, point => point.candidateActivityCount);
  const totalSourceActivities = sumPointCount(points, point => point.sourceActivityCount);
  const totalEligible = sumPointCount(points, point => point.eligibleSampleCount);
  const exclusionSummary = summarizeTrajectoryExclusions(points);
  return {
    contextKey: context.contextKey,
    contextLabel: formatContextLabel(context),
    title: `${formatScopeLabel(context.scope)} durability trend`,
    metricLabel: isPool ? 'Pace retained' : 'Aerobic decoupling',
    metricDescription: isPool
      ? 'Weekly median final-versus-early comparable-length pace retention.'
      : 'Weekly median first-versus-second-half aerobic-efficiency drift.',
    eligibilityDescription: isPower
      ? 'Only comparable steady power-and-heart-rate workouts produce a trend point.'
      : 'Only workouts that pass the comparability checks produce a trend point.',
    sourceActivityLabel,
    barExplanation: isPower
      ? 'Bar height shows power-recorded workouts; labels show eligible / power-recorded.'
      : 'Bar height shows candidate workouts; labels show eligible / candidates.',
    activityCountSummary: isPower
      ? `Across 12 weeks: ${totalCandidates} candidates · ${totalSourceActivities} with power · ${totalEligible} eligible`
      : `Across 12 weeks: ${totalCandidates} candidates · ${totalEligible} eligible`,
    exclusionSummary,
    unitLabel: '%',
    noEligibleWeekCount: points.filter(point => !point.hasEligibleSamples).length,
    unavailableMetricWeekCount: points.filter(point => point.hasEligibleSamples && point.value === null).length,
    points,
  };
}

function resolvePowerActivityCount(
  coverage: DerivedTrainingDurabilityMetricPayload['scopes'][number]['current']['coverage'],
): number {
  const missingPowerCount = coverage.exclusions
    .filter(exclusion => exclusion.reason === 'missing-output')
    .reduce((sum, exclusion) => sum + exclusion.activityCount, 0);
  return Math.max(0, coverage.evidenceActivityCount - missingPowerCount);
}

function sumPointCount(
  points: readonly TrainingDurabilityTrajectoryPointViewModel[],
  selector: (point: TrainingDurabilityTrajectoryPointViewModel) => number,
): number {
  return points.reduce((sum, point) => sum + selector(point), 0);
}

function summarizeTrajectoryExclusions(
  points: readonly TrainingDurabilityTrajectoryPointViewModel[],
): string | null {
  const counts = new Map<string, TrainingDurabilityExclusionViewModel>();
  points.forEach(point => point.exclusionReasons.forEach((exclusion) => {
    const current = counts.get(exclusion.reason);
    counts.set(exclusion.reason, {
      ...exclusion,
      activityCount: (current?.activityCount || 0) + exclusion.activityCount,
    });
  }));
  const exclusions = [...counts.values()]
    .filter(exclusion => exclusion.activityCount > 0)
    .sort((left, right) => right.activityCount - left.activityCount || left.label.localeCompare(right.label));
  return exclusions.length
    ? `Primary exclusions: ${exclusions.map(exclusion => `${exclusion.label} ${exclusion.activityCount}`).join(' · ')}`
    : null;
}

function resolveVisibleScopes(disciplines: readonly TrainingVisibleDiscipline[]): Set<DerivedTrainingDurabilityScope> {
  const result = new Set<DerivedTrainingDurabilityScope>();
  if (disciplines.includes('running')) result.add('running');
  if (disciplines.includes('cycling')) result.add('cycling');
  if (disciplines.includes('swimming')) { result.add('pool-swimming'); result.add('open-water-swimming'); }
  return result;
}
function formatScopeLabel(scope: DerivedTrainingDurabilityScope): string {
  return ({ running: 'Running', cycling: 'Cycling', 'pool-swimming': 'Pool', 'open-water-swimming': 'Open water' })[scope];
}
function formatContextLabel(context: DerivedTrainingDurabilityContext): string {
  if (context.scope === 'pool-swimming') {
    return `${context.poolLengthMeters === null ? 'Pool' : `${context.poolLengthMeters} m`} · ${context.stroke || 'mixed stroke'}`;
  }
  const source = context.outputSource === 'grade-adjusted-speed' ? 'Grade-adjusted speed' : context.outputSource === 'power' ? 'Power' : 'Speed';
  return `${formatScopeLabel(context.scope)} · ${source}`;
}
function formatMetric(value: number | null, suffix: string): string { return value === null ? '—' : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}${suffix}`; }
function formatPercent(value: number): string { return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)}%`; }
function formatExclusionReason(reason: string, powerContext = false): string {
  const labels: Record<string, string> = {
    'missing-output': powerContext ? 'No recorded power' : 'Missing required output',
    'missing-heart-rate': 'Missing heart rate',
    'insufficient-duration': 'Too short',
    'insufficient-coverage': 'Not enough paired data',
    'insufficient-halves': 'Uneven comparison coverage',
    'too-variable': 'Too variable',
    'too-intense': 'Too intense',
    'unsupported-context': 'Unsupported context',
  };
  return labels[reason] || reason.split('-').map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
}
