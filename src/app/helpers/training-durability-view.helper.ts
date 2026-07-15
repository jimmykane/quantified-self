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
  eligibleSampleCount: number;
  isEmpty: boolean;
}
export interface TrainingDurabilityTrajectoryViewModel {
  contextKey: string;
  contextLabel: string;
  metricLabel: string;
  metricDescription: string;
  unitLabel: '%';
  emptyWeekCount: number;
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
    const exclusions = item.current.coverage.exclusions.filter(exclusion => exclusion.activityCount > 0);
    return {
      scope: item.scope,
      label: formatScopeLabel(item.scope),
      evidenceText: `${item.current.coverage.eligibleActivityCount} eligible of ${item.current.coverage.candidateActivityCount} candidate activities`,
      coverageText: item.current.coverage.eligibilityRatio === null
        ? 'Eligibility ratio unavailable'
        : `${formatPercent(item.current.coverage.eligibilityRatio * 100)} eligibility`,
      exclusionText: exclusions.length
        ? exclusions.map(exclusion => `${formatExclusionReason(exclusion.reason)}: ${exclusion.activityCount}`).join(' · ')
        : null,
      contexts,
      trendText: `${eligibleWeeks} of 12 recent weeks include eligible evidence`,
      supportingEventsText: supportingLabels.length ? `Recent support: ${supportingLabels.join(' · ')}` : null,
    };
  });
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
      ? `${current.sampleCount} current samples${current.medianDurationSeconds === null ? '' : ` · median ${formatSleepDuration(current.medianDurationSeconds)}`}${current.medianCoverageRatio === null ? '' : ` · ${formatPercent(current.medianCoverageRatio * 100)} coverage`}`
      : 'No current eligible samples',
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
  const points = [...weeks]
    .sort((left, right) => left.windowStartDayMs - right.windowStartDayMs)
    .map((week) => {
      const summary = week.summaries.find(item => item.context.contextKey === context.contextKey) || null;
      return {
        weekStartDayMs: week.windowStartDayMs,
        weekEndDayMs: week.windowEndDayMs,
        value: isPool
          ? summary?.medianPaceRetentionPercent ?? null
          : summary?.medianDecouplingPercent ?? null,
        eligibleSampleCount: summary?.sampleCount ?? 0,
        isEmpty: !summary || summary.sampleCount === 0,
      };
    });
  return {
    contextKey: context.contextKey,
    contextLabel: formatContextLabel(context),
    metricLabel: isPool ? 'Pace retained' : 'Aerobic decoupling',
    metricDescription: isPool
      ? 'Median final-versus-early comparable-length pace retention by week.'
      : 'Median first-versus-second-half aerobic-efficiency drift by week.',
    unitLabel: '%',
    emptyWeekCount: points.filter(point => point.isEmpty).length,
    unavailableMetricWeekCount: points.filter(point => !point.isEmpty && point.value === null).length,
    points,
  };
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
function formatExclusionReason(reason: string): string { return reason.split('-').map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' '); }
