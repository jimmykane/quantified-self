import type { DerivedTrainingReadinessMetricPayload } from '@shared/derived-metrics';
import type { DashboardReadinessSignalsContext } from './dashboard-training-insights.helper';

export type TrainingReadinessViewState = 'preparing' | 'empty' | 'ready' | 'unavailable';
export type TrainingReadinessHistoryState = 'preparing' | 'updating' | 'empty' | 'ready' | 'unavailable';

export interface TrainingReadinessMetricRowViewModel {
  label: string;
  valueText: string;
  detailText: string;
}

export interface TrainingReadinessTrendPointViewModel {
  dayMs: number;
  score: number | null;
  x: number;
  y: number | null;
  label: string;
}

export interface TrainingReadinessTrendAxisTickViewModel {
  score: number;
  label: string;
  y: number;
  isReadinessThreshold: boolean;
}

export interface TrainingReadinessViewModel {
  state: TrainingReadinessViewState;
  label: string;
  scoreText: string;
  confidenceText: string;
  evidenceText: string;
  updatedText: string;
  detailText: string;
  implicationTitle: string;
  implicationText: string;
  sourceText: string;
  isUpdating: boolean;
  metricRows: TrainingReadinessMetricRowViewModel[];
  historyState: TrainingReadinessHistoryState;
  historyStatusText: string;
  historyEvidenceText: string;
  historyAriaLabel: string;
  historyStartLabel: string;
  historyEndLabel: string;
  historyPoints: TrainingReadinessTrendPointViewModel[];
  historySegments: string[];
  historyAxisTicks: TrainingReadinessTrendAxisTickViewModel[];
}

const HISTORY_CHART_WIDTH = 360;
const HISTORY_CHART_MIN_X = 30;
const HISTORY_CHART_MAX_X = HISTORY_CHART_WIDTH - 10;
const HISTORY_CHART_MIN_Y = 8;
const HISTORY_CHART_MAX_Y = 76;
const HISTORY_AXIS_TICK_SCORES = [100, 75, 55, 0] as const;

export function buildTrainingReadinessViewModel(
  context: DashboardReadinessSignalsContext | null | undefined,
  options: {
    isPreparing?: boolean;
    isUpdating?: boolean;
    locale?: string;
    calculatedAtMs?: number | null;
    sleepEvidenceFailed?: boolean;
    loadEvidenceFailed?: boolean;
    history?: DerivedTrainingReadinessMetricPayload | null;
    historyStatus?: string | null;
  } = {},
): TrainingReadinessViewModel {
  const sourceText = 'The current score and backend-derived 14-day history use the same readiness formula. '
    + 'History reads a Form snapshot seed and a bounded sleep envelope, with the same 30-day window applied at each daily cutoff; the browser does not load event or activity history. '
    + 'This is training context, not a medical score or workout prescription.';
  const history = buildTrainingReadinessHistoryViewModel(context, options);
  if (!context) {
    const isPreparing = options.isPreparing === true;
    const sleepEvidenceFailed = options.sleepEvidenceFailed === true;
    const loadEvidenceFailed = options.loadEvidenceFailed === true;
    const isUnavailable = !isPreparing && (sleepEvidenceFailed || loadEvidenceFailed);
    const unavailableDetailText = sleepEvidenceFailed && loadEvidenceFailed
      ? 'Current load and recorded sleep evidence could not be loaded. Refresh the page to retry.'
      : sleepEvidenceFailed
        ? 'Recorded sleep evidence could not be loaded, and no current load signals are available. Refresh the page to retry.'
        : 'Current load evidence could not be loaded, and no recent recorded sleep signals are available. Refresh the page to retry.';
    return {
      state: isPreparing ? 'preparing' : isUnavailable ? 'unavailable' : 'empty',
      label: isPreparing ? 'Preparing' : 'Unavailable',
      scoreText: '--',
      confidenceText: isPreparing ? 'Evidence loading' : 'No confidence level',
      evidenceText: '0/4 signals',
      updatedText: 'Not calculated',
      detailText: isPreparing
        ? 'Preparing current load and recorded recovery evidence.'
        : isUnavailable
          ? unavailableDetailText
          : 'No current load or recent recorded sleep signals are available.',
      implicationTitle: 'No training implication',
      implicationText: 'There is not enough current evidence to summarize readiness.',
      sourceText,
      isUpdating: isPreparing,
      metricRows: [],
      ...history,
    };
  }

  const locale = options.locale;
  const loadParts = [
    context.form === null ? null : `Form ${formatSignedNumber(context.form, locale, 1)}`,
    context.rampRate === null ? null : `Ramp ${formatSignedNumber(context.rampRate, locale, 1)}`,
  ].filter((part): part is string => part !== null);
  const latestSleepText = context.latestSleepAtMs === null
    ? 'No eligible night ended in the last 48 hours.'
    : `Latest eligible night ended ${formatDateTime(context.latestSleepAtMs, locale)}.`;
  const loadFreshnessText = context.loadAtMs === null || context.loadAtMs === undefined
    ? 'Current derived Form and ramp rate.'
    : `Derived load state through ${formatUtcDate(context.loadAtMs, locale)}.`;
  const implication = buildTrainingImplication(context.label);
  const sleepEvidenceFailed = options.sleepEvidenceFailed === true;
  const loadEvidenceFailed = options.loadEvidenceFailed === true;
  const hasRetainedSleepEvidence = sleepEvidenceFailed && context.latestSleepAtMs !== null;
  const evidenceWarnings = [
    loadEvidenceFailed
      ? 'One or more current load snapshots could not be loaded.'
      : null,
    sleepEvidenceFailed
      ? hasRetainedSleepEvidence
        ? 'Sleep updates failed; showing the last loaded evidence while it remains eligible.'
        : 'Recorded sleep evidence could not be loaded; showing available load signals only.'
      : null,
  ].filter((warning): warning is string => warning !== null);

  return {
    state: 'ready',
    label: context.label,
    scoreText: `${formatNumber(context.score, locale, 0)}/100`,
    confidenceText: `${capitalize(context.confidence)} confidence`,
    evidenceText: `${context.availableSignalCount}/${context.totalSignalCount} signals`,
    updatedText: Number.isFinite(options.calculatedAtMs)
      ? `Calculated ${formatDateTime(options.calculatedAtMs as number, locale)}`
      : 'Calculated from current evidence',
    detailText: evidenceWarnings.length
      ? `${evidenceWarnings.join(' ')} Refresh the page to retry.${options.isUpdating ? ' Other evidence is still updating.' : ''}`
      : options.isUpdating
      ? 'Showing available evidence while current signals update.'
      : 'Current load and recorded recovery evidence, with missing signals left explicit.',
    implicationTitle: implication.title,
    implicationText: implication.text,
    sourceText,
    isUpdating: options.isUpdating === true,
    metricRows: [
      {
        label: 'Load context',
        valueText: loadParts.length ? loadParts.join(' · ') : 'Unavailable',
        detailText: loadEvidenceFailed
          ? 'One or more current load snapshots could not be loaded.'
          : loadFreshnessText,
      },
      {
        label: 'Sleep',
        valueText: context.sleepScore === null
          ? 'Unavailable'
          : `${formatNumber(context.sleepScore, locale, 0)}/100`,
        detailText: sleepEvidenceFailed
          ? hasRetainedSleepEvidence
            ? `Sleep updates failed. ${latestSleepText}`
            : 'Recorded sleep evidence could not be loaded.'
          : latestSleepText,
      },
      {
        label: 'HRV vs baseline',
        valueText: formatRatio(context.hrvRatio, locale),
        detailText: 'Same-provider median; at least 3 prior nights required.',
      },
      {
        label: 'Overnight HR vs baseline',
        valueText: formatRatio(context.overnightHeartRateRatio, locale),
        detailText: 'Average sleep HR leads the bounded driver; minimum HR supports it when both are available. Same-provider median; at least 3 prior nights required.',
      },
    ],
    ...history,
  };
}

function buildTrainingReadinessHistoryViewModel(
  context: DashboardReadinessSignalsContext | null | undefined,
  options: {
    locale?: string;
    calculatedAtMs?: number | null;
    history?: DerivedTrainingReadinessMetricPayload | null;
    historyStatus?: string | null;
  },
): Pick<
  TrainingReadinessViewModel,
  | 'historyState'
  | 'historyStatusText'
  | 'historyEvidenceText'
  | 'historyAriaLabel'
  | 'historyStartLabel'
  | 'historyEndLabel'
  | 'historyPoints'
  | 'historySegments'
  | 'historyAxisTicks'
> {
  const history = options.history || null;
  const historyStatus = `${options.historyStatus || ''}`;
  if (!history) {
    const unavailable = historyStatus === 'failed';
    return {
      historyState: unavailable ? 'unavailable' : 'preparing',
      historyStatusText: unavailable
        ? 'Readiness history is unavailable. Refresh to request another snapshot.'
        : 'Preparing the backend-derived 14-day history.',
      historyEvidenceText: '0/14 days scored',
      historyAriaLabel: 'No readiness history is available.',
      historyStartLabel: '',
      historyEndLabel: '',
      historyPoints: [],
      historySegments: [],
      historyAxisTicks: buildHistoryAxisTicks(),
    };
  }

  const referenceTimeMs = Number.isFinite(options.calculatedAtMs)
    ? options.calculatedAtMs as number
    : Date.now();
  const referenceDate = new Date(referenceTimeMs);
  const currentUtcDayMs = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );
  const canReplaceCurrentDay = history.asOfDayMs === currentUtcDayMs && !!context;
  const points = history.points.map((point, index): TrainingReadinessTrendPointViewModel => {
    const useLiveCurrentContext = point.dayMs === history.asOfDayMs && canReplaceCurrentDay && !!context;
    const score = useLiveCurrentContext ? context.score : point.score;
    const label = useLiveCurrentContext ? context.label : point.label;
    const confidence = useLiveCurrentContext ? context.confidence : point.confidence;
    const availableSignalCount = useLiveCurrentContext
      ? context.availableSignalCount
      : point.availableSignalCount;
    const baselineEvidenceCount = useLiveCurrentContext
      ? context.baselineEvidenceCount
      : point.baselineEvidenceCount;
    const x = HISTORY_CHART_MIN_X + (
      index * (HISTORY_CHART_MAX_X - HISTORY_CHART_MIN_X) / Math.max(1, history.points.length - 1)
    );
    return {
      dayMs: point.dayMs,
      score,
      x: roundChartCoordinate(x),
      y: score === null ? null : scoreToHistoryChartY(score),
      label: buildHistoryPointLabel({
        dayMs: point.dayMs,
        score,
        label,
        confidence,
        availableSignalCount,
        baselineEvidenceCount,
        locale: options.locale,
      }),
    };
  });
  const scoredDayCount = points.filter(point => point.score !== null).length;
  const refreshFailed = historyStatus === 'failed';
  const historyIsStale = history.asOfDayMs < currentUtcDayMs;
  const isUpdating = (historyStatus !== 'ready' || historyIsStale) && !refreshFailed;
  const historyState: TrainingReadinessHistoryState = refreshFailed
    ? 'unavailable'
    : isUpdating
    ? 'updating'
    : scoredDayCount > 0 ? 'ready' : 'empty';

  return {
    historyState,
    historyStatusText: refreshFailed
      ? 'History refresh failed; the latest complete series remains visible.'
      : historyIsStale
        ? `History currently ends ${formatUtcDate(history.asOfDayMs, options.locale)}; requesting the current UTC day while the retained series remains visible.`
      : isUpdating
      ? 'Updating history; the latest complete series remains visible.'
      : scoredDayCount > 0
        ? 'Daily score at each UTC day cutoff; gaps mean no score was available.'
        : 'No day in this window had enough evidence for a readiness score.',
    historyEvidenceText: `${scoredDayCount}/${history.historyDays} days scored`,
    historyAriaLabel: `Readiness scores on a fixed 0 to 100 axis over 14 days. ${scoredDayCount} days have a score; missing days are gaps.`,
    historyStartLabel: formatUtcDate(points[0]?.dayMs, options.locale),
    historyEndLabel: formatUtcDate(points[points.length - 1]?.dayMs, options.locale),
    historyPoints: points,
    historySegments: buildHistorySegments(points),
    historyAxisTicks: buildHistoryAxisTicks(),
  };
}

function buildHistoryAxisTicks(): TrainingReadinessTrendAxisTickViewModel[] {
  return HISTORY_AXIS_TICK_SCORES.map(score => ({
    score,
    label: `${score}`,
    y: scoreToHistoryChartY(score),
    isReadinessThreshold: score === 75 || score === 55,
  }));
}

function scoreToHistoryChartY(score: number): number {
  return roundChartCoordinate(HISTORY_CHART_MAX_Y - (
    (Math.max(0, Math.min(100, score)) / 100) * (HISTORY_CHART_MAX_Y - HISTORY_CHART_MIN_Y)
  ));
}

function buildHistoryPointLabel({
  dayMs,
  score,
  label,
  confidence,
  availableSignalCount,
  baselineEvidenceCount,
  locale,
}: {
  dayMs: number;
  score: number | null;
  label: string | null;
  confidence: string | null;
  availableSignalCount: number;
  baselineEvidenceCount: number;
  locale?: string;
}): string {
  const dateText = formatUtcHistoryDate(dayMs, locale);
  if (score === null || label === null || confidence === null) {
    return `${dateText}: no readiness score; not enough evidence was available.`;
  }
  const baselineText = baselineEvidenceCount > 0
    ? `${baselineEvidenceCount} recovery-baseline ${baselineEvidenceCount === 1 ? 'night' : 'nights'}`
    : 'no recovery-baseline nights';
  return `${dateText}: ${formatNumber(score, locale, 0)}/100, ${label}. ${capitalize(confidence)} confidence; ${availableSignalCount}/4 signals; ${baselineText}.`;
}

function buildHistorySegments(points: readonly TrainingReadinessTrendPointViewModel[]): string[] {
  const segments: string[] = [];
  let currentSegment: string[] = [];
  points.forEach((point) => {
    if (point.y === null) {
      if (currentSegment.length) {
        segments.push(currentSegment.join(' '));
        currentSegment = [];
      }
      return;
    }
    currentSegment.push(`${point.x},${point.y}`);
  });
  if (currentSegment.length) {
    segments.push(currentSegment.join(' '));
  }
  return segments;
}

function buildTrainingImplication(label: DashboardReadinessSignalsContext['label']): {
  title: string;
  text: string;
} {
  if (label === 'Ready') {
    return {
      title: 'Signals are broadly supportive',
      text: 'Review the drivers and how you feel before deciding how to train; this score does not choose a workout.',
    };
  }
  if (label === 'Recover') {
    return {
      title: 'Signals lean toward lower readiness',
      text: 'Use the weaker and missing drivers as context alongside how you feel, not as an automatic workout change.',
    };
  }
  return {
    title: 'Signals are mixed',
    text: 'Review the weaker and missing drivers before deciding how to train; the score is context, not an instruction.',
  };
}

function formatRatio(value: number | null, locale?: string): string {
  return value === null
    ? 'Unavailable'
    : formatSignedNumber((value - 1) * 100, locale, 0, '%');
}

function formatSignedNumber(value: number, locale?: string, maximumFractionDigits = 1, suffix = ''): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatNumber(value, locale, maximumFractionDigits)}${suffix}`;
}

function formatNumber(value: number, locale?: string, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatUtcDate(value: number | null | undefined, locale?: string): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value as number));
}

function formatUtcHistoryDate(value: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function roundChartCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}
