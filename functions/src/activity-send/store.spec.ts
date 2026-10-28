import { FitEncoder } from 'fit-file-parser/encoder';
import { describe, expect, it, vi } from 'vitest';
import { describeFIT } from './store';
import { createCOROSActivityFITFixture } from '../../test-utils/coros-activity-fit';
vi.unmock('@sports-alliance/sports-lib');

describe('recording review', () => {
  it('reads the recorded sport and mapped Wahoo category from actual FIT bytes', async () => {
    const summary = await describeFIT(createCOROSActivityFITFixture({ sport: 1 }), 'Run.fit', 'wahoo');
    expect(summary.name).toBe('Run.fit');
    expect(summary.sport).toContain('Running');
    expect(summary.warnings).toContain('Wahoo activity category: RUNNING.');
  });
  it.each([false, true])('shows the Fishing GPS fallback notice without changing the source sport (GPS=%s)', async withGPS => {
    const input = createCOROSActivityFITFixture({ sport: 29, withGPS }), original = Buffer.from(input);
    const summary = await describeFIT(input, 'Fishing.fit', 'coros');
    expect(summary.sport).toBe('Fishing');
    expect(summary.warnings).toEqual(['COROS receives eligible GPS Fishing as GPS Cardio.']);
    expect(input).toEqual(original);
  });
  it.each([false, true])('shows Diving-to-Generic and depth display notices without requiring GPS (GPS=%s)', async withGPS => {
    const input = createCOROSActivityFITFixture({ sport: 53, withGPS, withDepth: true }), original = Buffer.from(input);
    const summary = await describeFIT(input, 'Dive.fit', 'coros');
    expect(summary.sport).toBe('Diving');
    expect(summary.warnings).toEqual(['COROS receives eligible Diving as Generic, with or without GPS. Depth stays in the FIT, but COROS may not display it or a dive profile.']);
    expect(input).toEqual(original);
  });
  it.each([29, 53])('does not advertise a single-session fallback for multi-session sport %i', async sport => {
    const summary = await describeFIT(createCOROSActivityFITFixture({ sport, sessionCount: 2 }), 'Multi.fit', 'coros');
    expect(summary.warnings).toEqual([]);
  });
  it.each(['suunto', 'wahoo'] as const)('keeps %s previews free of COROS-specific notices', async provider => {
    for (const sport of [29, 53]) {
      const summary = await describeFIT(createCOROSActivityFITFixture({ sport }), 'Activity.fit', provider);
      expect(summary.warnings).toEqual([]);
    }
  });
  it.each([1, 5, 85])('leaves unrelated sport %i previews unchanged', async sport => {
    const summary = await describeFIT(createCOROSActivityFITFixture({ sport }), 'Activity.fit', 'coros');
    expect(summary.warnings).toEqual([]);
  });
  it('rejects a course even when it contains session-like recording messages', async () => {
    const course = createCOROSActivityFITFixture({ headerSize: 14 });
    course[27] = 6; // Synthetic file_id type, after its fixed definition and data header.
    course.writeUInt16LE(FitEncoder.calculateCRC(course.subarray(0, -2)), course.length - 2);
    await expect(describeFIT(course, 'Course.fit', 'wahoo')).rejects.toThrow('Send course files from Routes');
  });
  it('rejects an unreadable file before confirmation', async () => {
    await expect(describeFIT(Buffer.from('invalid'), 'Broken.fit', 'suunto')).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
