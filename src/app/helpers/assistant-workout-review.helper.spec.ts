import { describe, expect, it } from 'vitest';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { assistantWorkoutReviewModel } from './assistant-workout-review.helper';
import { workoutReviewFixture } from './assistant-workout-review.test-support';

describe('Assistant workout review display', () => {
  it('uses analyzer coverage and repetition counts without making a partial time a complete total', () => {
    const review = workoutReviewFixture(); review.after!.structure.nodes[0].steps[1].ending = { kind: 'time', seconds: 75 };
    const view = assistantWorkoutReviewModel(review, normalizeUserUnitSettings(), 'en-US');
    expect(view.beforeSummary).toContain('timed subtotal'); expect(view.beforeSummary).toContain('unknown duration');
    expect(view.afterSummary).toContain('5m'); expect(view.afterSummary).toContain('4');
    expect(view.afterCounts).toBe('2 step definitions · 8 executions');
    expect(view.changedIds).toEqual(['recovery']);
    expect(view.changes[0]).toMatchObject({ label: 'Step 1.2', fieldsText: 'Duration / ending', afterLocation: 'Position 1.2' });
    expect(view.changes[0].afterText).toContain('Note: Keep <script> as text');
    expect(view.compatibility[2].label).toBe('Wahoo: exact → unsupported');
  });
  it('shows ordered target removal, repeat edits, date/destination changes and additions/deletions', () => {
    const review = workoutReviewFixture(); const repeat = review.after!.structure.nodes[0];
    repeat.count = 3; repeat.steps.reverse(); repeat.steps[1].targets = [];
    review.after!.destination = 'Plan: Ten weeks'; review.after!.localDate = '2026-10-08';
    const view = assistantWorkoutReviewModel(review);
    expect(view.changes.map(change => change.id)).toEqual(['block', 'recovery', 'kilometre']);
    expect(view.changes[2].fields).toEqual(['Targets', 'Order / repeat placement']);
    expect(view.changes[2].beforeText).toContain('bpm'); expect(view.changes[2].afterText).not.toContain('bpm');
    expect(view.metadata.map(value => value.label)).toEqual(['Date', 'Destination']);
    expect(assistantWorkoutReviewModel({ ...review, before: null }).changes.every(c => c.fieldsText === 'Added')).toBe(true);
    expect(assistantWorkoutReviewModel({ ...review, after: null }).changes.every(c => c.fieldsText === 'Removed')).toBe(true);
  });
  it('discloses edits below display precision and preserves owner distance settings', () => {
    const review = workoutReviewFixture(); review.after!.structure.nodes[0].steps[1].ending = { kind: 'time', seconds: 60.12500000001 };
    const view = assistantWorkoutReviewModel(review, { ...normalizeUserUnitSettings(), distanceUnits: DistanceUnits.Miles });
    expect(view.changes[0].precision).toContain('60.12500000001');
    expect(view.afterSummary).toContain('mi');
  });
});
