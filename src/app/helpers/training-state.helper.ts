export interface TrainingStateSignalInput {
  form: number | null;
  rampRate: number | null;
  fitness: number | null;
  fatigue: number | null;
}

export interface TrainingStateClassification {
  label: string | null;
  caption: string | null;
}

/**
 * Shared between the Training state card and its tests so the compact UI keeps
 * the underlying Form-model boundary visible without duplicating rules in the
 * workspace component.
 */
export const TRAINING_STATE_INFO_TOOLTIP = 'Training state uses TSS-derived Form (CTL minus ATL), 7-day CTL ramp, current CTL, and current ATL. Balanced means none of the Starting, overload, fatigued, building, fresh, or detraining thresholds applies. Sleep, session count, and 28-day training time do not change this label.';

export function resolveTrainingStateClassification(
  { form, rampRate, fitness, fatigue }: TrainingStateSignalInput,
): TrainingStateClassification {
  if (form === null && rampRate === null && fitness === null && fatigue === null) {
    return { label: null, caption: null };
  }

  if (fitness !== null && fitness < 5 && fatigue !== null && fatigue < 10) {
    return { label: 'Starting', caption: 'Low training history' };
  }

  if (
    form !== null
    && (form <= -30 || (form <= -20 && fatigue !== null && fitness !== null && fatigue > fitness * 1.25))
  ) {
    return { label: 'Overload', caption: 'Back off soon' };
  }

  if (form !== null && form <= -10) {
    return { label: 'Fatigued', caption: 'Absorb the load' };
  }

  if (rampRate !== null && rampRate >= 1 && (form === null || form < 6)) {
    return { label: 'Building', caption: 'Productive load' };
  }

  if (form !== null && form >= 8 && (rampRate === null || rampRate <= 0)) {
    return { label: 'Fresh', caption: 'Ready to train' };
  }

  if (rampRate !== null && rampRate <= -3 && (form === null || form > -8)) {
    return { label: 'Detraining', caption: 'Load is falling' };
  }

  return { label: 'Balanced', caption: 'Stable load' };
}
