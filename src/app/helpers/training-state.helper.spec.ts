import { describe, expect, it } from 'vitest';
import {
  buildTrainingStateInfo,
  resolveTrainingStateClassification,
  resolveTrainingStateInfoTooltip,
  TRAINING_STATE_INFO_TOOLTIP,
} from './training-state.helper';

describe('resolveTrainingStateClassification', () => {
  it('classifies conservative training states from the shared inputs', () => {
    expect(resolveTrainingStateClassification({ form: -35, rampRate: 1, fitness: 100, fatigue: 130 }))
      .toEqual({ label: 'Overload', caption: 'Back off soon' });
    expect(resolveTrainingStateClassification({ form: 10, rampRate: -1, fitness: 100, fatigue: 90 }))
      .toEqual({ label: 'Fresh', caption: 'Ready to train' });
    expect(resolveTrainingStateClassification({ form: 4, rampRate: 0, fitness: 100, fatigue: 96 }))
      .toEqual({ label: 'Balanced', caption: 'Stable load' });
  });

  it('does not invent a state without any current training signals', () => {
    expect(resolveTrainingStateClassification({ form: null, rampRate: null, fitness: null, fatigue: null }))
      .toEqual({ label: null, caption: null });
  });

  it('explains the Form-model inputs, current values, and why Balanced applies', () => {
    const input = {
      form: -6.6,
      rampRate: -0.35,
      fitness: 105.5,
      fatigue: 112.1,
    };
    const tooltip = resolveTrainingStateInfoTooltip(input);
    const info = buildTrainingStateInfo(input);

    expect(TRAINING_STATE_INFO_TOOLTIP).toContain('CTL minus ATL');
    expect(tooltip).toContain('Form -6.6 (CTL 105.5 − ATL 112.1)');
    expect(tooltip).toContain('7-day CTL ramp -0.35');
    expect(tooltip).toContain('Building specifically needs a 7-day CTL ramp of at least +1');
    expect(tooltip).toContain('Sleep, session count, and 28-day training time');
    expect(info.rows).toEqual([
      { label: 'Form (TSB)', value: '-6.6' },
      { label: 'CTL', value: '105.5' },
      { label: 'ATL', value: '112.1' },
      { label: '7-day CTL ramp', value: '-0.35' },
    ]);
    expect(info.description).toContain('Form (TSB) is CTL minus ATL');
  });

  it('keeps unavailable inputs explicit in the state explanation', () => {
    const input = { form: null, rampRate: null, fitness: null, fatigue: null };
    const tooltip = resolveTrainingStateInfoTooltip(input);
    const info = buildTrainingStateInfo(input);

    expect(tooltip).toContain('Form unavailable');
    expect(tooltip).toContain('7-day CTL ramp unavailable');
    expect(tooltip).toContain('CTL unavailable');
    expect(tooltip).toContain('ATL unavailable');
    expect(info.rows.map(row => row.value)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable']);
  });
});
