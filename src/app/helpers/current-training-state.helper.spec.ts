import { describe, expect, it } from 'vitest';
import { buildCurrentTrainingStateContext } from './current-training-state.helper';

describe('buildCurrentTrainingStateContext', () => {
  it('uses the current Form series for the shared fatigued state', () => {
    const nowMs = Date.UTC(2026, 6, 22, 12);
    const context = buildCurrentTrainingStateContext({
      nowMs,
      formPoints: [{
        time: Date.UTC(2026, 6, 22),
        trainingStressScore: 0,
        ctl: 102,
        atl: 114,
        formSameDay: -12,
        formPriorDay: -10,
      }],
      fallbackFormNow: { latestDayMs: nowMs, value: 99, trend8Weeks: [] },
      fallbackRampRate: { latestDayMs: nowMs, ctlToday: 102, ctl7DaysAgo: 100, rampRate: 2, trend8Weeks: [] },
    });

    expect(context.signals).toEqual({ form: -12, rampRate: 2, fitness: 102, fatigue: 114 });
    expect(context.state).toEqual({ label: 'Fatigued', caption: 'Absorb the load' });
    expect(context.info.rows).toContainEqual({ label: 'Form (TSB)', value: '-12' });
  });

  it('uses the compact Form and Ramp snapshots when the full series is unavailable', () => {
    const context = buildCurrentTrainingStateContext({
      formPoints: null,
      fallbackFormNow: { latestDayMs: Date.UTC(2026, 6, 22), value: 9, trend8Weeks: [] },
      fallbackRampRate: {
        latestDayMs: Date.UTC(2026, 6, 22),
        ctlToday: null,
        ctl7DaysAgo: null,
        rampRate: -1,
        trend8Weeks: [],
      },
    });

    expect(context.signals).toEqual({ form: 9, rampRate: -1, fitness: null, fatigue: null });
    expect(context.state).toEqual({ label: 'Fresh', caption: 'Ready to train' });
  });

  it('keeps the state unavailable when there are no TSS-derived inputs', () => {
    const context = buildCurrentTrainingStateContext({
      formPoints: null,
      fallbackFormNow: null,
      fallbackRampRate: null,
    });

    expect(context.state).toEqual({ label: null, caption: null });
    expect(context.info.rows.map(row => row.value)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable']);
  });
});
