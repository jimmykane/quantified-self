import type { HealthChangeSignal, HealthChangeState } from './health-change-summary.helper';

/** Already-assessed and already-formatted Today presentation; this helper does not calculate a score or threshold. */
export interface DashboardGlanceReadiness {
  loading: boolean;
  awaitingSleep: boolean;
  warningText: string;
  label: string;
  scoreText: string;
  confidenceText: string;
  evidenceText: string;
  sleepText: string;
  sleepContextText: string;
  overnightHeartRateText: string;
  overnightHeartRateTone: 'positive' | 'negative' | 'neutral';
  overnightHeartRateContextText: string;
  loadText: string;
  changeSignals: readonly HealthChangeSignal[];
}

export interface DashboardGlanceTrainingState {
  label: string;
  caption: string;
  scalePosition: number | null;
  scaleTone: 'positive' | 'negative' | 'neutral';
  contextText?: string;
}

export function buildDashboardGlanceSignals(
  view: DashboardGlanceReadiness,
  training: DashboardGlanceTrainingState,
  loadAvailability: 'available' | 'loading' | 'unavailable' | 'insufficient',
): HealthChangeSignal[] {
  const evidenceState = view.loading ? 'loading' : view.warningText ? 'unavailable' : 'insufficient';
  const sleep = view.changeSignals.find(signal => signal.id === 'sleep');
  const hrv = view.changeSignals.find(signal => signal.id === 'hrv');
  const readinessState: HealthChangeState = view.loading ? 'loading' : view.warningText ? 'unavailable'
    : view.awaitingSleep ? 'insufficient' : view.label === 'Ready' ? 'available'
    : view.label === 'Mixed' || view.label === 'Recover' ? 'attention' : 'insufficient';
  const readinessText = readinessState === 'loading' ? 'Readiness is still loading'
    : readinessState === 'unavailable' ? 'Readiness is unavailable'
    : readinessState === 'insufficient' ? 'Readiness is waiting for today’s sleep' : `Readiness is ${view.label}`;
  const sleepScoreMissing = sleep?.state === 'recorded' && view.sleepText === '--';
  const sleepState = view.loading ? 'loading' : view.warningText ? 'unavailable'
    : view.awaitingSleep || sleepScoreMissing ? 'insufficient' : sleep?.state ?? 'insufficient';
  const sleepText = sleepState === 'loading' ? 'Sleep is still loading' : sleepState === 'unavailable' ? 'Sleep is unavailable'
    : view.awaitingSleep ? 'Today’s sleep is not recorded yet' : sleepScoreMissing ? 'Today’s sleep is recorded without a score'
    : sleepState === 'insufficient' ? 'Today’s sleep is unavailable' : 'Today’s sleep is recorded';
  const hrvState = view.loading ? 'loading' : view.warningText ? 'unavailable' : hrv?.state ?? evidenceState;
  const heartRateState: HealthChangeState = view.loading ? 'loading' : view.warningText ? 'unavailable'
    : view.awaitingSleep || view.overnightHeartRateText === '--' ? 'insufficient'
    : view.overnightHeartRateTone === 'negative' ? 'attention' : 'available';
  const heartRateStatus = heartRateState === 'loading' ? 'Loading overnight HR'
    : heartRateState === 'unavailable' ? 'Overnight HR unavailable'
    : heartRateState === 'insufficient' ? 'No current comparable overnight HR'
    : view.overnightHeartRateTone === 'negative' ? 'Above baseline'
    : view.overnightHeartRateTone === 'positive' ? 'Below baseline' : 'Near baseline';
  const hasLoadAssessment = loadAvailability === 'available' && training.scalePosition !== null;
  const loadState: HealthChangeState = loadAvailability !== 'available' ? loadAvailability
    : !hasLoadAssessment ? 'insufficient' : training.scaleTone === 'negative' ? 'attention' : 'available';
  const loadStatus = loadState === 'loading' ? 'Loading training load' : loadState === 'unavailable' ? 'Training load unavailable'
    : loadState === 'insufficient' ? 'No current training-load assessment' : training.label;
  return [
    { id: 'readiness', label: 'Readiness', sourceLabel: 'Derived training load + recorded sleep signals', state: readinessState,
      statusText: readinessState === 'available' || readinessState === 'attention' ? `${view.label} · ${view.scoreText}` : readinessText,
      detailText: view.warningText || (view.loading ? 'Waiting for current load and sleep evidence.'
        : view.awaitingSleep ? view.sleepContextText : `${view.confidenceText} · ${view.evidenceText}`), summaryText: readinessText },
    { id: 'training-load', label: 'Training load', sourceLabel: 'TSS-backed training · independent of sleep', state: loadState,
      statusText: loadStatus, summaryText: loadState === 'available' || loadState === 'attention'
        ? `training state is ${training.label}` : loadStatus,
      detailText: hasLoadAssessment ? [training.caption, view.loadText.includes('--') ? '' : `Form / ramp ${view.loadText}`, training.contextText].filter(Boolean).join(' · ')
        : loadState === 'loading' ? 'Waiting for the current derived load assessment.' : 'No current derived load assessment is available.' },
    { id: 'sleep', label: 'Sleep', sourceLabel: sleep?.sourceLabel || 'No eligible current sleep source', state: sleepState,
      statusText: sleepState === 'recorded' ? view.sleepText === '--' ? 'Recorded sleep · no score' : `Sleep score ${view.sleepText}` : sleepText,
      detailText: [sleep?.detailText,
        view.awaitingSleep && view.sleepText !== '--' ? `Last available sleep score ${view.sleepText}` : '',
        view.sleepContextText].filter(Boolean).join(' · '), summaryText: sleepText },
    { ...(hrv || { id: 'hrv', label: 'HRV · 7-day average', sourceLabel: 'No eligible current HRV source',
      state: evidenceState, statusText: 'Not enough comparable HRV evidence', detailText: 'No current personal-range assessment.' }),
      state: hrvState,
      statusText: view.warningText ? 'HRV unavailable' : view.loading ? 'Loading HRV' : hrv?.statusText || 'Not enough comparable HRV evidence',
      detailText: view.warningText || (view.loading ? 'Waiting for current HRV evidence.' : hrv?.detailText || 'No current personal-range assessment.'),
      summaryText: hrvState === 'outside-range' ? 'Your 7-day HRV average is outside your usual range'
        : hrvState === 'within-range' ? 'Your 7-day HRV average is within your usual range'
        : hrvState === 'unavailable' ? 'HRV is unavailable' : hrvState === 'loading' ? 'HRV is still loading'
        : 'HRV needs more comparable readings' },
    { id: 'overnight-hr', label: 'Overnight HR', sourceLabel: sleep?.sourceLabel || 'No eligible current sleep source',
      state: heartRateState, statusText: heartRateStatus,
      detailText: [view.overnightHeartRateText === '--' ? '' : `${view.overnightHeartRateText} vs recorded sleep-source baseline`,
        view.overnightHeartRateContextText, view.warningText].filter(Boolean).join(' · ') || 'No current comparable overnight HR evidence.',
      summaryText: heartRateState === 'attention' ? 'overnight heart rate is above baseline' : heartRateStatus },
  ];
}
