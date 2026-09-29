import { describe, expect, it } from 'vitest';
import {
  buildTrainingLoadContribution,
  buildTrainingLoadPoints,
  buildTrainingSessionLoadImpact,
  resolveTrainingLoadDayImpact,
} from '@shared/training-load';

describe('training load impact', () => {
  it('splits one TSS load into CTL, ATL, and Form contributions', () => {
    expect(buildTrainingLoadContribution(84)).toEqual({
      trainingStressScore: 84,
      ctlContribution: 2,
      atlContribution: 12,
      formContribution: -10,
    });
    expect(buildTrainingLoadContribution(-1)).toBeNull();
    expect(buildTrainingLoadContribution(Number.NaN)).toBeNull();
  });

  it('reports actual day movement after normal decay', () => {
    const points = buildTrainingLoadPoints([
      { dayMs: Date.UTC(2026, 0, 1), load: 60 },
      { dayMs: Date.UTC(2026, 0, 2), load: 80 },
      { dayMs: Date.UTC(2026, 0, 3), load: 0 },
    ]);
    const raised = resolveTrainingLoadDayImpact(points, Date.UTC(2026, 0, 2));
    const declined = resolveTrainingLoadDayImpact(points, Date.UTC(2026, 0, 3));

    expect(raised?.outcome).toBe('raised');
    expect(raised?.ctlChange).toBeCloseTo((80 - points[0].ctl) / 42);
    expect(declined?.outcome).toBe('declined');
    expect(declined?.ctlChange).toBeLessThan(0);
  });

  it('holds CTL when daily TSS exactly matches prior CTL', () => {
    const firstDayMs = Date.UTC(2026, 0, 1);
    const secondDayMs = Date.UTC(2026, 0, 2);
    const points = buildTrainingLoadPoints([
      { dayMs: firstDayMs, load: 420 },
      { dayMs: secondDayMs, load: 10 },
    ]);
    expect(resolveTrainingLoadDayImpact(points, secondDayMs)).toMatchObject({
      previousCtl: 10,
      trainingStressScore: 10,
      ctl: 10,
      ctlChange: 0,
      outcome: 'held',
    });
  });

  it('uses zero as the baseline on the first Training day', () => {
    const points = buildTrainingLoadPoints([{ dayMs: Date.UTC(2026, 0, 1), load: 42 }]);
    expect(resolveTrainingLoadDayImpact(points, Date.UTC(2026, 0, 1))).toMatchObject({
      previousCtl: 0,
      previousAtl: 0,
      ctlChange: 1,
      atlChange: 6,
      formChange: -5,
      outcome: 'raised',
    });
  });

  it('classifies a session by its role in the full UTC-day load', () => {
    const pushedDay = {
      ...resolveTrainingLoadDayImpact(
        buildTrainingLoadPoints([
          { dayMs: Date.UTC(2026, 0, 1), load: 420 },
          { dayMs: Date.UTC(2026, 0, 2), load: 20 },
        ]),
        Date.UTC(2026, 0, 2),
      )!,
      previousCtl: 10,
      trainingStressScore: 20,
    };
    expect(buildTrainingSessionLoadImpact(15, pushedDay)?.role).toBe('pushed-above-maintenance');
    expect(buildTrainingSessionLoadImpact(5, { ...pushedDay, trainingStressScore: 30 })?.role)
      .toBe('added-to-building-day');
    expect(buildTrainingSessionLoadImpact(5, { ...pushedDay, previousCtl: 40 })?.role)
      .toBe('offset-fitness-decay');
    expect(buildTrainingSessionLoadImpact(5, {
      ...pushedDay, previousCtl: 20, trainingStressScore: 20,
    })?.role).toBe('offset-fitness-decay');
    expect(buildTrainingSessionLoadImpact(0, pushedDay)?.role).toBe('no-load');
    expect(buildTrainingSessionLoadImpact(21, pushedDay)).toBeNull();
  });

  it('rejects non-UTC day keys and missing days', () => {
    const points = buildTrainingLoadPoints([{ dayMs: Date.UTC(2026, 0, 1), load: 20 }]);
    expect(resolveTrainingLoadDayImpact(points, Date.UTC(2026, 0, 1) + 1)).toBeNull();
    expect(resolveTrainingLoadDayImpact(points, Date.UTC(2026, 0, 2))).toBeNull();
  });
});
