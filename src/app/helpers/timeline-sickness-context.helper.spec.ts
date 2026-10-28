import { describe, expect, it, vi } from 'vitest';
import type { TimelineNote } from '@shared/timeline-notes';
import { activeSicknessNotes, currentSicknessNoteRange, sicknessNoteLabel } from './timeline-sickness-context.helper';

const note: TimelineNote = { id: 'a', category: 'sickness', title: 'Sore throat', startDate: '2026-10-21', endDate: null,
  timeZone: 'Europe/Helsinki', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
const now = Date.UTC(2026, 9, 24, 12);
describe('Current sickness context', () => {
  it('includes single-day and ongoing notes, with inclusive end dates', () => {
    expect(activeSicknessNotes([note, { ...note, id: 'b', endDate: '2026-10-24' },
      { ...note, id: 'c', startDate: '2026-10-24', endDate: '2026-10-24' }], now)).toHaveLength(3);
  });
  it('excludes ended, future, hidden and non-sickness notes without guessing from their text', () => {
    expect(activeSicknessNotes([{ ...note, endDate: '2026-10-23' }, { ...note, startDate: '2026-10-25' },
      { ...note, showOnCharts: false }, { ...note, category: 'other', title: 'Sickness' }], now)).toEqual([]);
  });
  it('evaluates each note in its captured timezone, across midnight and DST', () => {
    const nearMidnight = Date.UTC(2026, 9, 24, 22, 30);
    expect(activeSicknessNotes([{ ...note, endDate: '2026-10-24' }], nearMidnight)).toEqual([]);
    expect(activeSicknessNotes([{ ...note, endDate: '2026-10-24', timeZone: 'America/Los_Angeles' }], nearMidnight)).toHaveLength(1);
    expect(activeSicknessNotes([{ ...note, startDate: '2026-10-25', endDate: '2026-10-25' }], Date.UTC(2026, 9, 25, 1, 30))).toHaveLength(1);
  });
  it('registers a bounded current-day window covering all note timezones', () => {
    expect(currentSicknessNoteRange(now)).toEqual({ startDate: '2026-10-23', endDate: '2026-10-25' });
    expect(activeSicknessNotes([{ ...note, timeZone: 'Pacific/Kiritimati', startDate: '2026-10-25' }], now)).toHaveLength(1);
  });
  it('uses the app date formatter without shifting the saved calendar date and discloses overlapping notes', () => {
    expect(sicknessNoteLabel([note], now, 'en-GB')).toBe('Sickness noted · since 21 Oct');
    expect(sicknessNoteLabel([{ ...note, startDate: '2025-12-30' }], now, 'en-GB')).toBe('Sickness noted · since 30 Dec 2025');
    expect(sicknessNoteLabel([note, { ...note, id: 'b', startDate: '2026-10-20' }], now, 'en-GB')).toBe('2 sickness notes · since 20 Oct');
    expect(sicknessNoteLabel([], now)).toBe('');
  });
  it('resolves today once per captured timezone at the existing 512-note limit', () => {
    const formatter = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    try {
      expect(activeSicknessNotes(Array.from({ length: 512 }, (_, index) => ({ ...note, id: String(index) })), now)).toHaveLength(512);
      expect(formatter).toHaveBeenCalledTimes(1);
    } finally { formatter.mockRestore(); }
  });
});
