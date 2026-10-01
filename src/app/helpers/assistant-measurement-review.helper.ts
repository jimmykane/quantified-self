import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { AssistantContentProposalPreview } from '@shared/assistant.types';
import { HEALTH_METRIC_CATALOG, HEALTH_METRIC_IDS } from '@shared/health';
import type { ManualHealthMeasurementFields } from '@shared/manual-health';
import { formatCanonicalHealthMetricSportsLibValue } from '@shared/sports-lib-health-data';

/** Review server-validated canonical fields; never render the model's input number as canonical. */
export function assistantMeasurementReviewDetails(proposal: AssistantContentProposalPreview,
  unitSettings?: UserUnitSettingsInterface): string[] {
  const review = proposal.measurementReview;
  if (!review) return [proposal.summary, 'Refresh this change to review its exact measurement.'];
  const describe = (fields: ManualHealthMeasurementFields, prefix: string): string[] => {
    const display = formatCanonicalHealthMetricSportsLibValue(fields.metricId, fields.canonicalValue, unitSettings);
    if (!display) return [`${prefix}: Measurement unavailable`];
    const label = HEALTH_METRIC_CATALOG[fields.metricId].label;
    const paired = fields.diastolicValue === undefined ? null
      : formatCanonicalHealthMetricSportsLibValue(HEALTH_METRIC_IDS.BloodPressureDiastolic, fields.diastolicValue, unitSettings);
    const value = `${display.value}${paired ? ` / ${paired.value}` : ''} ${display.unit}`.trim();
    const offset = fields.timezoneOffsetSeconds;
    const magnitude = Math.abs(offset);
    const pad = (n: number) => String(n).padStart(2, '0');
    const zone = `UTC${offset < 0 ? '-' : '+'}${pad(Math.floor(magnitude / 3600))}:${pad(Math.floor(magnitude % 3600 / 60))}${magnitude % 60 ? `:${pad(magnitude % 60)}` : ''}`;
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', year: 'numeric', month: 'short',
      day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .format(fields.observedAtMs + offset * 1000);
    const lines = [`${prefix}: ${label} — ${value}`, `Observed: ${time} (${zone})`];
    if (fields.pulseValue !== undefined) {
      const pulse = formatCanonicalHealthMetricSportsLibValue(HEALTH_METRIC_IDS.PulseRate, fields.pulseValue, unitSettings);
      if (pulse) lines.push(`Pulse: ${pulse.value} ${pulse.unit}`.trim());
    }
    if (fields.vo2Context && fields.vo2Method) lines.push(`Context: ${fields.vo2Context}; method: ${fields.vo2Method.replaceAll('_', ' ')}`);
    return lines;
  };
  return [
    ...(review.before ? describe(review.before, 'Current') : []),
    ...(review.after ? describe(review.after, review.before ? 'New' : 'Log') : ['This manual entry will be permanently deleted. It cannot be restored.']),
  ];
}
