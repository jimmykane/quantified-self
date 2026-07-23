export interface TrainingMetricTextSegment {
  text: string;
  isMetric: boolean;
}

const TRAINING_METRIC_COUNT_UNIT_PATTERN = [
  '(?:(?:active|recorded|parent|candidate|eligible|recent|classified|unclassified|matching|power-recorded)\\s+)*',
  '(?:workouts?|sessions?|activities?|events?|nights?|days?|weeks?|years?|signals?|samples?|blocks?|efforts?)',
].join('');

const TRAINING_METRIC_UNIT_PATTERN = [
  '\\/\\s*100\\s*(?:m|yd)',
  'ml\\s*\\/\\s*kg\\s*\\/\\s*min',
  'W\\s*\\/\\s*kg',
  'km\\s*\\/\\s*h',
  'm\\s*\\/\\s*s',
  'min\\s*\\/\\s*(?:km|mi)',
  TRAINING_METRIC_COUNT_UNIT_PATTERN,
  'points?',
  'pts?',
  'TSS',
  'bpm',
  'rpm',
  'spm',
  'kcal',
  'km',
  'mi',
  'yd',
  'ft',
  'kg',
  'ms',
  'W',
  'h',
  'm',
  's',
  'd',
  '%',
].join('|');

const TRAINING_METRIC_TOKEN_PATTERN = new RegExp(
  `(?:[-+−±]\\s*|\\/\\s*)?\\d+(?:(?:[.,]|[\\u00a0\\u202f])\\d+)*(?::\\d{1,2})*(?:\\s*(?:${TRAINING_METRIC_UNIT_PATTERN}))?`,
  'gi',
);

export function segmentTrainingMetricText(value: string | null | undefined): TrainingMetricTextSegment[] {
  const text = `${value ?? ''}`;
  if (!text) {
    return [];
  }

  const segments: TrainingMetricTextSegment[] = [];
  let textStart = 0;
  TRAINING_METRIC_TOKEN_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(TRAINING_METRIC_TOKEN_PATTERN)) {
    const matchStart = match.index;
    if (matchStart > textStart) {
      segments.push({ text: text.slice(textStart, matchStart), isMetric: false });
    }
    segments.push({ text: match[0], isMetric: true });
    textStart = matchStart + match[0].length;
  }

  if (textStart < text.length) {
    segments.push({ text: text.slice(textStart), isMetric: false });
  }

  return segments;
}
