import type { HealthChangeSignal } from './health-change-summary.helper';

export interface DashboardDailyBriefing {
  headline: string;
  tone: 'neutral' | 'positive' | 'caution' | 'error';
}

const priority = { unavailable: 0, attention: 1, 'outside-range': 1, insufficient: 2, loading: 3 };

function clause(signal: HealthChangeSignal): string {
  if (signal.id === 'hrv') {
    if (signal.state === 'within-range') return '7-day HRV is within your usual range';
    if (signal.state === 'outside-range') return '7-day HRV is outside your usual range';
  }
  const text = signal.summaryText || `${signal.label}: ${signal.statusText}`;
  return text.replace(/^[A-Z](?=[a-z])/, initial => initial.toLowerCase()).replace(/\.$/, '');
}

/** Summarize Today's existing assessments; no additional reads, scores, thresholds or advice. */
export function buildDashboardDailyBriefing(signals: readonly HealthChangeSignal[]): DashboardDailyBriefing {
  if (!signals.length) return { headline: 'Today’s training and recovery signals are not available yet.', tone: 'neutral' };
  if (signals.every(signal => signal.state === 'loading')) {
    return { headline: 'Today’s training and recovery signals are still loading.', tone: 'neutral' };
  }
  const training = signals.find(signal => signal.id === 'training-load');
  const readiness = signals.find(signal => signal.id === 'readiness');
  const supporting = signals.filter(signal => signal !== training && signal !== readiness);
  // Mention missing/error evidence before a reassuring HRV status. All details remain directly below.
  const relevant = supporting.filter(signal => priority[signal.state] !== undefined)
    .sort((a, b) => priority[a.state] - priority[b.state])[0]
    || supporting.find(signal => signal.id === 'hrv' && signal.state === 'within-range');
  const clauses = [training, readiness, relevant].filter((signal): signal is HealthChangeSignal => !!signal).map(clause);
  if (!clauses.length) clauses.push(clause(signals[0]));
  const sentence = clauses.length > 2 ? `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}` : clauses.join(' and ');
  const tone = signals.some(signal => signal.state === 'unavailable') ? 'error'
    : signals.some(signal => signal.state === 'attention' || signal.state === 'outside-range') ? 'caution'
    : signals.some(signal => signal.state === 'loading' || signal.state === 'insufficient') ? 'neutral'
    : training?.state === 'available' && readiness?.state === 'available' ? 'positive' : 'neutral';
  return { headline: sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.', tone };
}
