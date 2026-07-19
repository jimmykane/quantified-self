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
 * Shared baseline for state explanations. The current input values are added by
 * resolveTrainingStateInfoTooltip so the displayed state is auditable without
 * duplicating the state rules in the workspace component.
 */
export const TRAINING_STATE_INFO_TOOLTIP = 'Training state uses TSS-derived Form (CTL minus ATL), 7-day CTL ramp, current CTL, and current ATL.';

function formatStateInput(value: number | null, maximumFractionDigits: number, signed = false): string {
  if (value === null || !Number.isFinite(value)) {
    return 'unavailable';
  }
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)}`;
}

export function resolveTrainingStateInfoTooltip(input: TrainingStateSignalInput): string {
  const { form, rampRate, fitness, fatigue } = input;
  const state = resolveTrainingStateClassification(input);
  const formText = form === null || !Number.isFinite(form)
    ? 'Form unavailable'
    : `Form ${formatStateInput(form, 1, true)}${fitness !== null && Number.isFinite(fitness) && fatigue !== null && Number.isFinite(fatigue)
      ? ` (CTL ${formatStateInput(fitness, 1)} − ATL ${formatStateInput(fatigue, 1)})`
      : ''}`;
  const details = [
    formText,
    `7-day CTL ramp ${formatStateInput(rampRate, 2, true)}`,
    fitness === null || !Number.isFinite(fitness) ? 'CTL unavailable' : '',
    fatigue === null || !Number.isFinite(fatigue) ? 'ATL unavailable' : '',
  ].filter(Boolean).join('; ');
  const decision = state.label === 'Balanced'
    ? 'Balanced applies because these values do not meet the Starting, overload, fatigued, building, fresh, or detraining thresholds. Building specifically needs a 7-day CTL ramp of at least +1 and Form below +6 (or unavailable).'
    : state.label
      ? `${state.label} is selected by the first matching state rule.`
      : 'The state is awaiting data until at least one load signal is available.';

  return `${TRAINING_STATE_INFO_TOOLTIP} Current inputs: ${details}. ${decision} Sleep, session count, and 28-day training time do not change this label.`;
}

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
