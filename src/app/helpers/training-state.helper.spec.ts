import { describe, expect, it } from 'vitest';
import {
  resolveTrainingStateClassification,
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

  it('documents the Form-model inputs and what does not affect the state', () => {
    expect(TRAINING_STATE_INFO_TOOLTIP).toContain('CTL minus ATL');
    expect(TRAINING_STATE_INFO_TOOLTIP).toContain('7-day CTL ramp');
    expect(TRAINING_STATE_INFO_TOOLTIP).toContain('Sleep, session count, and 28-day training time');
  });
});
