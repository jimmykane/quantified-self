import { describe, expect, it, vi } from 'vitest';
import { queryMcpTimelineNotes, McpTimelineNotesInput, McpTimelineNotesReads,
  MCP_TIMELINE_NOTES_SCHEMA, MCP_TIMELINE_NOTES_LIMITS } from './timeline-notes.service';

const now = Date.parse('2026-09-09T00:30:00Z');
const input: McpTimelineNotesInput = { uid: 'owner', connectionId: 'connection', scopes: ['timeline-notes:read'],
  startDate: '2026-09-01', endDate: '2026-09-30' };
const codec = {
  encode: (value: Record<string, unknown>, uid: string, connectionId: string) => Buffer.from(JSON.stringify({ value, uid, connectionId })).toString('base64url'),
  decode: (value: string, uid: string, connectionId: string) => {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (uid !== parsed.uid || connectionId !== parsed.connectionId) throw new Error();
    return parsed.value;
  },
};
function note(index = 1, overrides: Record<string, unknown> = {}) {
  return { id: index.toString(16).padStart(64, '0'), data: { category: 'sickness', title: `Context ${index}`,
    details: 'Full private text', startDate: '2026-09-01', endDate: '2026-09-02', timeZone: 'UTC',
    revision: 1, createdAtMs: 1, updatedAtMs: 1, showOnCharts: false, color: 'red',
    neighboringSecret: 'never-return-this', ...overrides } };
}
function reads(closed = [note()], ongoing: ReturnType<typeof note>[] = []): McpTimelineNotesReads {
  return { activeOwner: vi.fn().mockResolvedValue(true), fetchPage: vi.fn(async (_uid, _range, phase, size, position) => {
    const docs = phase === 'closed' ? closed : ongoing;
    const start = position ? docs.findIndex(doc => doc.id === position.id) + 1 : 0;
    return docs.slice(start, start + size);
  }) };
}
describe('MCP full Timeline notes projection', () => {
  it('requires its independent permission before any account or note reads', async () => {
    const source = reads();
    await expect(queryMcpTimelineNotes({ ...input, scopes: ['metrics:read', 'health:read'] }, source, codec, now))
      .rejects.toMatchObject({ code: 'invalid_request' });
    expect(source.activeOwner).not.toHaveBeenCalled();
    expect(source.fetchPage).not.toHaveBeenCalled();
  });
  it('returns full hidden note text and only the intentional fields', async () => {
    const result = await queryMcpTimelineNotes(input, reads(), codec, now);
    expect(result.notes).toEqual([{ category: 'sickness', title: 'Context 1', details: 'Full private text',
      startDate: '2026-09-01', endDate: '2026-09-02', timeZone: 'UTC', effectiveEndDate: '2026-09-02' }]);
    expect(result.scanComplete).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/neighboringSecret|never-return|showOnCharts|revision|createdAt|updatedAt|color|owner|connection/);
    expect(MCP_TIMELINE_NOTES_SCHEMA.safeParse({ ...result, raw: 'forbidden' }).success).toBe(false);
  });
  it('includes long-running periods and inclusive endpoints plus future bounded notes', async () => {
    const result = await queryMcpTimelineNotes(input, reads([
      note(1, { startDate: '2020-01-01', endDate: input.startDate }),
      note(2, { startDate: input.endDate, endDate: '2027-01-01' }),
    ]), codec, now);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0].startDate).toBe('2020-01-01');
  });
  it('uses each captured timezone for ongoing overlap and freezes it across pages', async () => {
    const source = reads([], [note(1, { endDate: null, timeZone: 'America/Los_Angeles' }), note(2, { endDate: null, timeZone: 'Pacific/Auckland' })]);
    const first = await queryMcpTimelineNotes({ ...input, limit: 1 }, source, codec, now);
    const second = await queryMcpTimelineNotes({ ...input, limit: 1, cursor: first.nextCursor! }, source, codec, now + 86_400_000);
    expect(first.notes[0].effectiveEndDate).toBe('2026-09-08');
    expect(second.notes[0].effectiveEndDate).toBe('2026-09-09');
    expect(second.scanComplete).toBe(true);
    expect((await queryMcpTimelineNotes({ ...input, startDate: '2026-09-10' }, source, codec, now)).notes).toEqual([]);
  });
  it.each([1, 32, 64])('continues across both queries without losing the next note (limit %i)', async limit => {
    const source = reads(Array.from({ length: 65 }, (_, i) => note(i + 1)), [note(66, { endDate: null }), note(67, { endDate: null })]);
    let cursor: string | undefined;
    const titles: string[] = [];
    do {
      const result = await queryMcpTimelineNotes({ ...input, limit, cursor }, source, codec, now);
      titles.push(...result.notes.map(item => item.title));
      expect(result.scanComplete).toBe(result.nextCursor === null);
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    expect(titles).toEqual(Array.from({ length: 67 }, (_, i) => `Context ${i + 1}`));
  });
  it('bounds scans of invalid records and resumes beyond them', async () => {
    const source = reads(Array.from({ length: 513 }, (_, i) => note(i + 1, i < 512 ? { title: '' } : {})));
    const first = await queryMcpTimelineNotes(input, source, codec, now);
    expect(first).toMatchObject({ recordsScanned: 512, skippedRecords: 512, notes: [], limitsReached: ['records'] });
    const second = await queryMcpTimelineNotes({ ...input, cursor: first.nextCursor! }, source, codec, now);
    expect(second.notes[0].title).toBe('Context 513');
  });
  it('preserves Unicode details intact when output needs continuation', async () => {
    const details = '界'.repeat(2_000);
    const source = reads(Array.from({ length: 40 }, (_, i) => note(i + 1, { details })));
    const result = await queryMcpTimelineNotes({ ...input, limit: 64 }, source, codec, now);
    expect(result.limitsReached).toEqual(['output_bytes']);
    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.notes.every(item => item.details === details)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(MCP_TIMELINE_NOTES_LIMITS.outputBytes);
    const next = await queryMcpTimelineNotes({ ...input, cursor: result.nextCursor! }, source, codec, now);
    expect(next.notes[0].title).toBe(`Context ${result.notes.length + 1}`);
  });
  it('bounds projected input before advancing the next unconsumed record', async () => {
    const source = reads([note(1, { details: 'x'.repeat(1_000_000) }), note(2, { details: 'x'.repeat(1_000_000) }), note(3, { details: 'x'.repeat(200_000) }), note(4)]);
    const first = await queryMcpTimelineNotes(input, source, codec, now);
    expect(first.limitsReached).toEqual(['input_bytes']);
    const next = await queryMcpTimelineNotes({ ...input, cursor: first.nextCursor! }, source, codec, now);
    expect(next.notes[0].title).toBe('Context 4');
  });
  it.each([{ startDate: '2026-02-29' }, { endDate: '2026-08-31' }, { endDate: '2027-09-02' }, { limit: 65 }, { limit: 0 }])(
    'rejects invalid requests before reads: %j', async change => {
      const source = reads();
      await expect(queryMcpTimelineNotes({ ...input, ...change }, source, codec, now)).rejects.toMatchObject({ code: 'invalid_request' });
      expect(source.fetchPage).not.toHaveBeenCalled();
    });
  it('accepts a 366-day leap-year window', async () => {
    const result = await queryMcpTimelineNotes({ ...input, startDate: '2024-01-01', endDate: '2024-12-31' }, reads([]), codec, now);
    expect(result.scanComplete).toBe(true);
  });
  it.each([{ uid: 'other' }, { connectionId: 'other' }, { startDate: '2026-09-02' }, { cursor: 'tampered' }])(
    'rejects cursor replay or tampering: %j', async change => {
      const source = reads([note(1), note(2)]);
      const first = await queryMcpTimelineNotes({ ...input, limit: 1 }, source, codec, now);
      vi.mocked(source.fetchPage).mockClear();
      await expect(queryMcpTimelineNotes({ ...input, cursor: first.nextCursor!, ...change }, source, codec, now)).rejects.toMatchObject({ code: 'invalid_request' });
      expect(source.fetchPage).not.toHaveBeenCalled();
    });
  it('does not release notes when account deletion starts during a read', async () => {
    const source = reads();
    vi.mocked(source.activeOwner).mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(queryMcpTimelineNotes(input, source, codec, now)).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
