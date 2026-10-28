import type { AppSwimLength } from './event-swim-length.helper';
import { getSwimLengthDistance, getSwimLengthDuration } from './event-swim-analytics.helper';

export interface SwimCoverageField {
  key: 'strokes' | 'distance' | 'duration';
  label: string;
  available: number;
  explanation: string;
  affected: { index: number; lapIndex: number | null }[];
}
export interface SwimCoverage {
  total: number;
  incomplete: number;
  recordedActiveCount: number | null;
  countMismatch: boolean;
  fields: SwimCoverageField[];
}

/** Coverage of usable active-length inputs, not a claim about independent watch lap summaries. */
export function getSwimCoverage(lengths: readonly AppSwimLength[], recordedCount?: unknown): SwimCoverage | null {
  const active = lengths.filter(length => length.type.trim().toLowerCase() === 'active');
  const recordedActiveCount = typeof recordedCount === 'number' && Number.isSafeInteger(recordedCount) && recordedCount >= 0 ? recordedCount : null;
  const countMismatch = recordedActiveCount !== null && recordedActiveCount !== active.length;
  const incomplete = new Set<AppSwimLength>();
  const definitions: { key: SwimCoverageField['key']; label: string; explanation: string;
    usable: (length: AppSwimLength) => boolean }[] = [
    { key: 'strokes', label: 'Stroke counts',
      explanation: 'Length-derived total strokes and SWOLF need a usable stroke count for every active length.',
      usable: length => typeof length.strokes === 'number' && Number.isFinite(length.strokes) && length.strokes >= 0 },
    { key: 'distance', label: 'Distance',
      explanation: 'Length-derived distance, pace and SWOLF need complete distance. Missing distance can use recorded pool length; invalid distance cannot.',
      usable: length => getSwimLengthDistance(length) !== null },
    { key: 'duration', label: 'Timing',
      explanation: 'Length-derived duration, pace and SWOLF need usable timing for every active length. Rejected timing stays unavailable.',
      usable: length => getSwimLengthDuration(length) !== null },
  ];
  const fields = definitions.flatMap(({ usable, ...definition }) => {
    const missing = active.filter(length => !usable(length));
    missing.forEach(length => incomplete.add(length));
    return missing.length ? [{ ...definition, available: active.length - missing.length,
      affected: missing.map(length => ({ index: length.index, lapIndex: length.lapIndex })) }] : [];
  });
  return fields.length || countMismatch ? { total: active.length, incomplete: incomplete.size, fields, recordedActiveCount, countMismatch } : null;
}
