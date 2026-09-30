import { describe, expect, it } from 'vitest';
import { buildTrainingLoadPoints } from '@shared/training-load';
import {
  buildTrainingDayImpactView,
  buildTrainingSessionImpactView,
  resolveTrainingImpactUtcDayMs,
} from './training-impact.helper';
import type { TrainingImpactSnapshotState } from '../services/training-impact.service';

function event(
  id: string,
  start: string,
  tss: number | null,
  options: { isMerge?: boolean; isBenchmark?: boolean; legacyTss?: number | null } = {},
): any {
  return {
    isMerge: options.isMerge === true,
    hasBenchmark: options.isBenchmark === true,
    startDate: new Date(start),
    getID: () => id,
    getStat: (type: string) => {
      if (type === 'Training Stress Score' && tss !== null) return { getValue: () => tss };
      if (type === 'Power Training Stress Score' && options.legacyTss != null) {
        return { getValue: () => options.legacyTss };
      }
      return null;
    },
  };
}

function ready(loads: Array<{ dayMs: number; load: number }>): TrainingImpactSnapshotState {
  return {
    status: 'ready',
    formPoints: buildTrainingLoadPoints(loads).map(point => ({
      time: point.dayMs,
      trainingStressScore: point.load,
      ctl: point.ctl,
      atl: point.atl,
      formSameDay: point.formSameDay,
      formPriorDay: point.formPriorDay,
    })),
  };
}

describe('training impact view helper', () => {
  it('maps an activity to its UTC Training day and contribution', () => {
    const activity = event('session', '2026-01-02T00:30:00+02:00', 42);
    const dayMs = Date.UTC(2026, 0, 1);
    expect(resolveTrainingImpactUtcDayMs(activity)).toBe(dayMs);
    const view = buildTrainingSessionImpactView(activity, ready([{ dayMs, load: 42 }]));
    expect(view.availability).toBe('ready');
    expect(view.headline).toBe('Helped push the day above maintenance');
    expect(view.impact).toMatchObject({ ctlContribution: 1, atlContribution: 6, formContribution: -5 });
  });

  it('uses the legacy TSS fallback when the current stat is missing', () => {
    const dayMs = Date.UTC(2026, 0, 1);
    const view = buildTrainingSessionImpactView(
      event('legacy', '2026-01-01T10:00:00Z', null, { legacyTss: 84 }),
      ready([{ dayMs, load: 84 }]),
    );
    expect(view.impact).toMatchObject({ trainingStressScore: 84, ctlContribution: 2 });
  });

  it('keeps missing TSS, merge exclusion, and updating state explicit', () => {
    const source = ready([{ dayMs: Date.UTC(2026, 0, 1), load: 42 }]);
    expect(buildTrainingSessionImpactView(event('missing', '2026-01-01T10:00:00Z', null), source))
      .toMatchObject({ availability: 'missing-tss' });
    expect(buildTrainingSessionImpactView(event('merge', '2026-01-01T10:00:00Z', 42, { isMerge: true }), source))
      .toMatchObject({ availability: 'excluded' });
    expect(buildTrainingSessionImpactView(event('benchmark', '2026-01-01T10:00:00Z', 42, { isBenchmark: true }), source))
      .toMatchObject({ availability: 'excluded' });
    expect(buildTrainingSessionImpactView(event('pending', '2026-01-01T10:00:00Z', 42), {
      status: 'updating', formPoints: null,
    })).toMatchObject({ availability: 'updating' });
  });

  it('sums visible session contributions and keeps UTC-day outcomes separate', () => {
    const firstDayMs = Date.UTC(2026, 0, 1);
    const secondDayMs = Date.UTC(2026, 0, 2);
    const source = ready([
      { dayMs: firstDayMs, load: 42 },
      { dayMs: secondDayMs, load: 84 },
    ]);
    const view = buildTrainingDayImpactView([
      event('late', '2026-01-01T23:30:00Z', 42),
      event('early', '2026-01-02T00:30:00Z', 84),
    ], source);

    expect(view.availability).toBe('ready');
    expect(view.headline).toBe('Activities span 2 UTC Training days');
    expect(view.trainingStressScore).toBe(126);
    expect(view.ctlContribution).toBe(3);
    expect(view.atlContribution).toBe(18);
    expect(view.formContribution).toBe(-15);
    expect(view.outcomes.map(outcome => outcome.dayMs)).toEqual([firstDayMs, secondDayMs]);
  });

  it('retains a ready partial total while counting unavailable activities', () => {
    const firstDayMs = Date.UTC(2026, 0, 1);
    const secondDayMs = Date.UTC(2026, 0, 2);
    const view = buildTrainingDayImpactView([
      event('loaded', '2026-01-01T10:00:00Z', 42),
      event('missing', '2026-01-02T00:30:00Z', null),
    ], ready([
      { dayMs: firstDayMs, load: 42 },
      { dayMs: secondDayMs, load: 0 },
    ]));
    expect(view.availability).toBe('ready');
    expect(view.unavailableSessionCount).toBe(1);
    expect(view.message).toContain('Some completed activities');
    expect(view.headline).toBe('Activities span 2 UTC Training days');
    expect(view.outcomes.map(outcome => outcome.dayMs)).toEqual([firstDayMs, secondDayMs]);
  });

  it('does not add an outcome for an excluded benchmark Training day', () => {
    const firstDayMs = Date.UTC(2026, 0, 1);
    const secondDayMs = Date.UTC(2026, 0, 2);
    const view = buildTrainingDayImpactView([
      event('loaded', '2026-01-01T10:00:00Z', 42),
      event('benchmark', '2026-01-02T00:30:00Z', 84, { isBenchmark: true }),
    ], ready([
      { dayMs: firstDayMs, load: 42 },
      { dayMs: secondDayMs, load: 84 },
    ]));

    expect(view.outcomes.map(outcome => outcome.dayMs)).toEqual([firstDayMs]);
  });
});
