import { describe, expect, it } from 'vitest';
import { WeightUnits } from '@sports-alliance/sports-lib';
import type { AssistantContentProposalPreview } from '@shared/assistant.types';
import { assistantMeasurementReviewDetails } from './assistant-measurement-review.helper';
const fields = { metricId: 'body_weight' as const, canonicalValue: 80,
  observedAtMs: Date.parse('2026-10-01T08:00:00Z'), timezoneOffsetSeconds: 10800 };
const proposal: AssistantContentProposalPreview = { kind: 'update_manual_measurement',
  proposalRef: 'proposal', summary: 'Edit weight', expiresAtMs: 1, requiresConfirmation: true,
  arguments: { measurementRef: 'ref', expectedRevision: 1, value: 81, unit: 'kg' },
  measurementReview: { before: fields, after: { ...fields, canonicalValue: 81 } } };
describe('manual measurement review', () => {
  it('renders canonical before/after values in the owner units with the saved offset', () => {
    const metric = assistantMeasurementReviewDetails(proposal);
    expect(metric[0]).toContain('80.0 kg'); expect(metric[2]).toContain('81.0 kg');
    expect(metric[1]).toContain('11:00:00 (UTC+03:00)');
    const imperial = assistantMeasurementReviewDetails(proposal, { weightUnits: WeightUnits.Pounds } as never);
    expect(imperial[0]).toContain('lb'); expect(imperial[0]).not.toContain('80.0 kg');
  });
  it('clearly explains permanent deletion and displays the paired reading', () => {
    const details = assistantMeasurementReviewDetails({ ...proposal, kind: 'delete_manual_measurement',
      arguments: { measurementRef: 'ref', expectedRevision: 1 }, measurementReview: { after: null,
        before: { ...fields, metricId: 'blood_pressure_systolic', canonicalValue: 120, diastolicValue: 80, pulseValue: 60 } } });
    expect(details[0]).toContain('120 / 80'); expect(details.join(' ')).toContain('60 bpm');
    expect(details.at(-1)).toContain('cannot be restored');
  });
});
