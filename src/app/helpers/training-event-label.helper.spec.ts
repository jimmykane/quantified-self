import { describe, expect, it } from 'vitest';
import {
  isGenericTrainingEventLabel,
  resolveTrainingEventDisplayLabel,
} from './training-event-label.helper';

describe('training-event-label.helper', () => {
  it('keeps a meaningful event name', () => {
    expect(resolveTrainingEventDisplayLabel(' Gran Fondo ')).toBe('Gran Fondo');
    expect(isGenericTrainingEventLabel('Gran Fondo')).toBe(false);
  });

  it('suppresses default or timestamp-like event names', () => {
    expect(resolveTrainingEventDisplayLabel('New Event')).toBeNull();
    expect(resolveTrainingEventDisplayLabel('2026-03-14T08:30:00.000Z')).toBeNull();
    expect(resolveTrainingEventDisplayLabel('')).toBeNull();
    expect(isGenericTrainingEventLabel(null)).toBe(true);
  });
});
