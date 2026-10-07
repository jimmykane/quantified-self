import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { AssistantWorkoutReview } from '@shared/assistant-workout-review';

export function workoutReviewFixture(): AssistantWorkoutReview {
  const before = { title: 'Mixed workout', localDate: '2026-10-07', destination: 'Standalone', lifecycle: 'planned' as const,
    structure: { version: 1 as const, sport: ActivityTypes.Running, nodes: [{ kind: 'repeat' as const, id: 'block', count: 4, steps: [
      { kind: 'step' as const, id: 'kilometre', purpose: 'work' as const, ending: { kind: 'distance' as const, meters: 1000 }, targets: [
        { kind: 'heart-rate' as const, mode: 'absolute' as const, minimumBpm: 130, maximumBpm: 150 },
      ] }, { kind: 'step' as const, id: 'recovery', purpose: 'recovery' as const, ending: { kind: 'time' as const, seconds: 60.125 }, targets: [], note: 'Keep <script> as text' },
    ] }] } };
  return { index: 0, before, after: structuredClone(before), compatibility: ['garmin', 'coros', 'wahoo', 'suunto'].map(provider => ({
    provider: provider as 'garmin', before: 'exact', after: provider === 'wahoo' ? 'unsupported' : 'degraded', issues: ['Local mapping limitation'],
  })) };
}
