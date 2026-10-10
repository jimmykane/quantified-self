import { readFitMessages, readFitUnsignedField } from 'fit-file-parser/raw';
import { FitActivitySessionRepair } from './fit-activity-session-repair';

import { sessionlessFixture } from '../../test-utils/fit-activity-session';

describe('shared missing FIT activity Session repair', () => {
  it.each([false, true])('derives only evidenced totals, preserving all original data (big endian=%s)', bigEndian => {
    const input = sessionlessFixture({ bigEndian, developer: true, indexed: true }), original = Buffer.from(input);
    const output = FitActivitySessionRepair.createCopy(input);
    expect(input).toEqual(original);
    expect(output).not.toBe(input);
    const before = readFitMessages(input), after = readFitMessages(output);
    expect(after.issues).toEqual([]);
    const session = after.messages.find(m => m.globalMessageNumber === 18)!;
    const val = (n: number, type = 6, size: 1 | 2 | 4 = 4) => readFitUnsignedField(
      session.fields.find(f => f.fieldNumber === n), type, size, session.littleEndian);
    expect([val(2), val(253), val(7), val(8), val(9), val(11, 4, 2), val(26, 4, 2), val(5, 0, 1)])
      .toEqual([1000, 1400, 400000, 398000, 120000, 50, 2, 5]);
    const withoutNewSummary = (ms: typeof before.messages) => ms.filter(m => m.globalMessageNumber !== 18)
      .map(m => m.globalMessageNumber === 34 ? { ...m, fields: m.fields.filter(f => f.fieldNumber !== 1) } : m);
    expect(withoutNewSummary(after.messages)).toEqual(withoutNewSummary(before.messages));
    expect(after.messages.at(-1)!.globalMessageNumber).toBe(34);
    expect(FitActivitySessionRepair.createCopy(output)).toBe(output);
  });

  it.each([12, 14] as const)('retains a %i-byte header and compressed records', headerSize => {
    const input = sessionlessFixture({ headerSize, compressed: true });
    const output = FitActivitySessionRepair.createCopy(input);
    expect(output).not.toBe(input);
    expect(output[0]).toBe(headerSize);
    expect(readFitMessages(output).messages.filter(m => m.globalMessageNumber === 20))
      .toEqual(readFitMessages(input).messages.filter(m => m.globalMessageNumber === 20));
  });

  it.each([1, 5, 82])('is provider-neutral for evidenced sport %i', sport => {
    const input = sessionlessFixture({ sport, declaredCount: 1 });
    expect(FitActivitySessionRepair.createCopy(input)).not.toBe(input);
  });

  it.each([
    { declaredCount: 3 }, { secondSport: 1 }, { secondStart: 1199 }, { secondStart: 1201 },
    { omitField: 7 }, { omitField: 8 }, { omitField: 9 }, { omitField: 25 },
    { extraTimer: true }, { existingSession: true }, { footerFirst: true },
    { invalidType: true }, { overflow: true }, { sport: 17 }, { sport: 254 },
    { firstRecordTime: 999 }, { lastRecordTime: 1401 }, { lastRecordTime: 999 },
    { noRecords: true }, { leadingVendor: true }, { omitField: 253 },
    { activityType: 1 }, { activityTimer: 400000 }, { lapElapsed: 200999 },
    { lapElapsed: 200000, lapTimer: 200001 }, { lapTimer: 0 },
  ])('leaves ambiguous or out-of-scope input unchanged: %j', options => {
    const input = sessionlessFixture(options), before = Buffer.from(input);
    expect(FitActivitySessionRepair.createCopy(input)).toBe(input);
    expect(input).toEqual(before);
  });

  it('omits missing optional totals rather than inventing them', () => {
    const output = FitActivitySessionRepair.createCopy(sessionlessFixture({ omitField: 11 }));
    const session = readFitMessages(output).messages.find(m => m.globalMessageNumber === 18)!;
    expect(session.fields.some(f => f.fieldNumber === 11)).toBe(false);
  });

  it('does not repair corrupt or truncated inputs', () => {
    const corrupt = sessionlessFixture(); corrupt[corrupt.length - 1] ^= 1;
    for (const input of [corrupt, corrupt.subarray(0, -8), Buffer.alloc(0)]) {
      expect(FitActivitySessionRepair.createCopy(input)).toBe(input);
    }
  });
});
