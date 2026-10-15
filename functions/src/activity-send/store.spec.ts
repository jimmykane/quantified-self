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
