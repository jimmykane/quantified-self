import type { HealthChangeSignal } from './health-change-summary.helper';
import type { DashboardAssessmentSignal, DashboardAssessmentTone } from './dashboard-glance.helper';

export interface DashboardDailyBriefing {
  headline: string;
  tone: DashboardAssessmentTone;
  parts: { text: string; tone: DashboardAssessmentTone }[];
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

function phraseTone(signal: DashboardAssessmentSignal): DashboardAssessmentTone {
  if (signal.state === 'unavailable') return 'error';
  if (signal.state === 'loading' || signal.state === 'insufficient' || signal.state === 'recorded') return 'neutral';
  if (signal.state === 'attention' || signal.state === 'outside-range') return signal.tone === 'error' ? 'error' : 'caution';
  return signal.tone ?? 'positive';
}

function neutralBriefing(headline: string): DashboardDailyBriefing {
  return { headline, tone: 'neutral', parts: [{ text: headline, tone: 'neutral' }] };
}

/** Summarize Today's existing assessments; no additional reads, scores, thresholds or advice. */
export function buildDashboardDailyBriefing(signals: readonly DashboardAssessmentSignal[]): DashboardDailyBriefing {
  if (!signals.length) return neutralBriefing('Today’s training and recovery signals are not available yet.');
  if (signals.every(signal => signal.state === 'loading')) {
    return neutralBriefing('Today’s training and recovery signals are still loading.');
  }
  const training = signals.find(signal => signal.id === 'training-load');
  const readiness = signals.find(signal => signal.id === 'readiness');
  const supporting = signals.filter(signal => signal !== training && signal !== readiness);
  // Mention missing/error evidence before a reassuring HRV status. All details remain directly below.
  const relevant = supporting.filter(signal => priority[signal.state] !== undefined)
    .sort((a, b) => priority[a.state] - priority[b.state])[0]
    || supporting.find(signal => signal.id === 'hrv' && signal.state === 'within-range');
  const selected = [training, readiness, relevant].filter((signal): signal is DashboardAssessmentSignal => !!signal);
  if (!selected.length) selected.push(signals[0]);
  const parts: DashboardDailyBriefing['parts'] = [];
  selected.forEach((signal, index) => {
    if (index) parts.push({ text: selected.length === 2 ? ' and ' : index === selected.length - 1 ? ', and ' : ', ', tone: 'neutral' });
    const text = clause(signal);
    parts.push({ text: index ? text : text.charAt(0).toUpperCase() + text.slice(1), tone: phraseTone(signal) });
  });
  parts.push({ text: '.', tone: 'neutral' });
  const tone = signals.some(signal => signal.state === 'unavailable') ? 'error'
    : signals.some(signal => signal.state === 'attention' || signal.state === 'outside-range') ? 'caution'
    : signals.some(signal => signal.state === 'loading' || signal.state === 'insufficient') ? 'neutral'
    : training?.state === 'available' && readiness?.state === 'available' ? 'positive' : 'neutral';
  return { headline: parts.map(part => part.text).join(''), tone, parts };
}
