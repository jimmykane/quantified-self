import { FitEncoder } from 'fit-file-parser/encoder';
import { getFitSportName, getFitSubSportName } from 'fit-file-parser/profile';
import { readFitMessages } from 'fit-file-parser/raw';
import { ActivityTypes, EventImporterFIT } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import { createParsingOptions } from '../../../shared/parsing-options';
import { buildActivitySyncOutboundFingerprintIds } from '../activity-sync/outbound-fingerprint';
import { createCOROSSailingFIT, createCOROSSnorkelingFIT, prepareCOROSActivityFITUpload } from './activity-fit';
import { createCOROSActivityFITFixture as fixture } from '../../test-utils/coros-activity-fit';
import { sessionlessFixture } from '../../test-utils/fit-activity-session';

function repairCRC(file: Buffer): Buffer {
  if (file[0] === 14) file.writeUInt16LE(FitEncoder.calculateCRC(file.subarray(0, 12)), 12);
  file.writeUInt16LE(FitEncoder.calculateCRC(file.subarray(0, -2)), file.length - 2);
  return file;
}

describe('COROS snorkeling FIT copy', () => {
  it.each([12, 14] as const)('adds missing sub_sport using a valid %i-byte header', headerSize => {
    const input = fixture({ headerSize }), before = Buffer.from(input);
    const output = createCOROSSnorkelingFIT(input);
    expect(input).toEqual(before);
    expect(output).not.toBe(input);
    expect(output[0]).toBe(headerSize);
    expect(output.length).toBe(input.length + 12); // One enum definition + value per category message.
    const parsed = readFitMessages(output);
    expect(parsed.issues).toEqual([]);
    expect(parsed.profileVersion).toBe(21176);
    for (const [global, sportField, subField] of [[12, 0, 1], [18, 5, 6], [19, 25, 39]]) {
      const message = parsed.messages.find(m => m.globalMessageNumber === global)!;
      expect(message.fields.find(f => f.fieldNumber === sportField)!.bytes[0]).toBe(5);
      const subSport = message.fields.find(f => f.fieldNumber === subField)!.bytes[0];
      expect(subSport).toBe(18);
      expect(getFitSubSportName(subSport)).toBe('open_water');
    }
    expect(getFitSportName(5)).toBe('swimming');
    expect(getFitSubSportName(17)).toBe('lap_swimming');
  });

  it.each([false, true])('preserves every unrelated native/developer field (big endian=%s)', bigEndian => {
    const input = fixture({ bigEndian, developer: true, compressed: true, withSubSport: true });
    const output = createCOROSSnorkelingFIT(input);
    expect(output.length).toBe(input.length);
    const original = readFitMessages(input), changed = readFitMessages(output);
    const fields = new Map([[12, [0, 1]], [18, [5, 6]], [19, [25, 39]]]);
    const withoutCategory = (m: typeof original.messages[number]) => ({ ...m,
      fields: m.fields.filter(f => !(fields.get(m.globalMessageNumber) ?? []).includes(f.fieldNumber)) });
    expect(changed.messages.map(withoutCategory)).toEqual(original.messages.map(withoutCategory));
    // With no inserted fields, even the binary envelope is identical outside six enum bytes and CRC.
    const differences = [...output.keys()].filter(index => output[index] !== input[index]);
    expect(differences).toHaveLength(8);
    expect(output.includes(Buffer.from([0x85]))).toBe(true);
  });

  it('retains developer bytes when inserting missing fields ahead of them', () => {
    const input = fixture({ developer: true, bigEndian: true, compressed: true });
    const output = createCOROSSnorkelingFIT(input);
    const before = readFitMessages(input), after = readFitMessages(output);
    expect(after.messages.map(m => m.developerFields)).toEqual(before.messages.map(m => m.developerFields));
    expect(after.messages.find(m => m.globalMessageNumber === 19)!.fields.find(f => f.fieldNumber === 26)!.bytes[0]).toBe(7);
    expect(after.messages.filter(m => m.globalMessageNumber === 20)).toEqual(before.messages.filter(m => m.globalMessageNumber === 20));
  });

  it('does not invent missing GPS or swimming metrics', () => {
    const input = fixture({ withGPS: false });
    const output = createCOROSSnorkelingFIT(input);
    expect(readFitMessages(output).messages.filter(m => m.globalMessageNumber === 20))
      .toEqual(readFitMessages(input).messages.filter(m => m.globalMessageNumber === 20));
    expect(readFitMessages(output).messages.find(m => m.globalMessageNumber === 18)!.fields.map(f => f.fieldNumber).sort())
      .toEqual([253, 2, 5, 6, 7, 9, 200].sort());
  });

  it('patches every data record sharing one definition, including compressed lap headers', () => {
    const input = fixture({ compressedLap: true, developer: true });
    const output = createCOROSSnorkelingFIT(input);
    const before = readFitMessages(input).messages.filter(m => m.globalMessageNumber === 19);
    const after = readFitMessages(output).messages.filter(m => m.globalMessageNumber === 19);
    expect(after).toHaveLength(2);
    expect(after[1].compressedTimestamp).toBe(before[1].compressedTimestamp);
    expect(after.map(m => m.developerFields)).toEqual(before.map(m => m.developerFields));
    for (const lap of after) {
      expect(lap.fields.find(f => f.fieldNumber === 25)!.bytes[0]).toBe(5);
      expect(lap.fields.find(f => f.fieldNumber === 39)!.bytes[0]).toBe(18);
    }
  });

  it('refuses a full definition instead of wrapping its field count', () => {
    expect(() => createCOROSSnorkelingFIT(fixture({ fullSessionDefinition: true }))).toThrow('full FIT field definition');
  });

  it('refuses array-shaped sport fields instead of editing just their first byte', () => {
    expect(() => createCOROSSnorkelingFIT(fixture({ malformedSport: true }))).toThrow('expected unsigned type');
  });

  it.each([1, 2, 5, 32, 53, 81, 83])('refuses non-snorkeling sport %i, including sailing/diving', sport => {
    const input = fixture({ sport }), before = Buffer.from(input);
    expect(() => createCOROSSnorkelingFIT(input)).toThrow('single-session snorkeling');
    expect(input).toEqual(before);
  });

  it.each([0, 2])('refuses %i-session files', sessionCount => {
    expect(() => createCOROSSnorkelingFIT(fixture({ sessionCount }))).toThrow('single-session snorkeling');
  });

  it('refuses a conflicting lap sport without mutating its input', () => {
    const input = fixture();
    const pattern = Buffer.from([0, 0xe8, 3, 0, 0, 82, 7]);
    const index = input.indexOf(pattern);
    expect(index).toBeGreaterThan(0);
    input[index + 5] = 1; repairCRC(input);
    expect(() => createCOROSSnorkelingFIT(input)).toThrow('conflicting FIT sport');
  });

  it('refuses a non-activity file', () => {
    const input = fixture(); input[input[0] + 13] = 6; repairCRC(input);
    expect(() => createCOROSSnorkelingFIT(input)).toThrow('single-session snorkeling');
  });

  it('refuses corrupt, truncated and oversized input rather than repairing it', () => {
    const corrupt = fixture(); corrupt[corrupt.length - 1] ^= 1;
    expect(() => createCOROSSnorkelingFIT(corrupt)).toThrow('invalid_crc');
    expect(() => createCOROSSnorkelingFIT(fixture().subarray(0, -3))).toThrow('invalid_header');
    expect(() => createCOROSSnorkelingFIT(Buffer.alloc(30 * 1024 * 1024 + 1))).toThrow('input_limit');
  });
});

describe('COROS sailing FIT copy', () => {
  it.each([false, true])('changes only classification, preserving opaque fields and GPS (big endian=%s)', bigEndian => {
    const input = fixture({ sport: 32, bigEndian, developer: true, compressed: true, compressedLap: true });
    const untouched = Buffer.from(input);
    const output = createCOROSSailingFIT(input);
    expect(input).toEqual(untouched);
    const before = readFitMessages(input), after = readFitMessages(output);
    const categoryFields = new Map([[12, [0, 1]], [18, [5, 6]], [19, [25, 39]]]);
    const withoutCategory = (m: typeof before.messages[number]) => ({ ...m,
      fields: m.fields.filter(f => !(categoryFields.get(m.globalMessageNumber) ?? []).includes(f.fieldNumber)) });
    expect(after.issues).toEqual([]);
    expect(after.messages.map(withoutCategory)).toEqual(before.messages.map(withoutCategory));
    for (const message of after.messages) {
      for (const field of categoryFields.get(message.globalMessageNumber) ?? []) {
        expect(message.fields.find(f => f.fieldNumber === field)!.bytes).toEqual(Buffer.from([0]));
      }
    }
    expect(getFitSportName(0)).toBe('generic');
    expect(getFitSubSportName(0)).toBe('generic');
  });

  it('does not add GPS and handles existing scalar category fields', () => {
    const input = fixture({ sport: 32, withSubSport: true, withGPS: false });
    const output = createCOROSSailingFIT(input);
    expect(output.length).toBe(input.length);
    expect(readFitMessages(output).messages.filter(m => m.globalMessageNumber === 20))
      .toEqual(readFitMessages(input).messages.filter(m => m.globalMessageNumber === 20));
  });

  it.each([0, 5, 82])('refuses non-sailing sport %i', sport => {
    expect(() => createCOROSSailingFIT(fixture({ sport }))).toThrow('single-session sailing');
  });

  it('refuses multiple sessions, conflicting lap sport, and corrupt data', () => {
    expect(() => createCOROSSailingFIT(fixture({ sport: 32, sessionCount: 2 })))
      .toThrow('single-session sailing');
    const mixed = fixture({ sport: 32 });
    const index = mixed.indexOf(Buffer.from([0, 0xe8, 3, 0, 0, 32, 7]));
    expect(index).toBeGreaterThan(0);
    mixed[index + 5] = 82; repairCRC(mixed);
    expect(() => createCOROSSailingFIT(mixed)).toThrow('conflicting FIT sport');
    const corrupt = fixture({ sport: 32 }); corrupt[corrupt.length - 1] ^= 1;
    expect(() => createCOROSSailingFIT(corrupt)).toThrow('invalid_crc');
  });
});

describe('COROS production FIT preparation', () => {
  it.each([undefined, 0])('preserves summary-only Multisport with sub-sport %s without inventing records', subSport => {
    const input = fixture({ sport: 18, subSport, withSubSport: subSport !== undefined, summaryOnly: true });
    const original = Buffer.from(input), output = prepareCOROSActivityFITUpload(input);
    expect(input).toEqual(original);
    const before = readFitMessages(input), after = readFitMessages(output);
    expect(after.issues).toEqual([]);
    expect(after.messages.map(message => message.globalMessageNumber)).toEqual([0, 18, 34]);
    const withoutCategory = (messages: typeof before.messages) => messages.map(message => ({ ...message,
      fields: message.fields.filter(field => message.globalMessageNumber !== 18 || ![5, 6].includes(field.fieldNumber)) }));
    expect(withoutCategory(after.messages)).toEqual(withoutCategory(before.messages));
    const session = after.messages[1];
    expect(session.fields.find(field => field.fieldNumber === 5)!.bytes).toEqual(Buffer.from([0]));
    expect(session.fields.find(field => field.fieldNumber === 6)!.bytes).toEqual(Buffer.from([0]));
  });

  it.each([[4, 14], [18, 0], [18, undefined]] as const)(
    'maps single-session %i/%s to Generic while preserving every other field', (sport, subSport) => {
      for (const withGPS of [false, true]) for (const bigEndian of [false, true]) {
        const input = fixture({ sport, subSport, withSubSport: subSport !== undefined,
          withGPS, bigEndian, developer: true, compressed: true, compressedLap: true });
        const original = Buffer.from(input), output = prepareCOROSActivityFITUpload(input);
        expect(input).toEqual(original);
        expect(output).not.toEqual(input);
        const before = readFitMessages(input), after = readFitMessages(output);
        const categoryFields = new Map([[12, [0, 1]], [18, [5, 6]], [19, [25, 39]]]);
        const withoutCategory = (message: typeof before.messages[number]) => ({ ...message,
          fields: message.fields.filter(field => !(categoryFields.get(message.globalMessageNumber) ?? []).includes(field.fieldNumber)) });
        expect(after.issues).toEqual([]);
        expect(after.messages.map(withoutCategory)).toEqual(before.messages.map(withoutCategory));
        for (const message of after.messages) for (const field of categoryFields.get(message.globalMessageNumber) ?? []) {
          expect(message.fields.find(value => value.fieldNumber === field)!.bytes).toEqual(Buffer.from([0]));
        }
        expect(prepareCOROSActivityFITUpload(output)).toBe(output);
      }
    },
  );

  it.each([[4, 14, 'indoor_rowing_to_generic'], [18, 0, 'single_session_multisport_to_generic']] as const)(
    'logs only the fixed new category label for %i/%i', (sport, subSport, mapping) => {
      vi.mocked(logger.info).mockClear();
      prepareCOROSActivityFITUpload(fixture({ sport, subSport, withSubSport: true, withGPS: false }));
      expect(logger.info).toHaveBeenCalledExactlyOnceWith('[COROS] Applied activity FIT category fallback.', { mapping });
    },
  );

  it.each([[4, undefined], [4, 0], [4, 20], [4, 26], [15, 14], [18, 80], [18, 126], [18, 255]] as const)(
    'preserves unverified fitness and multisport subtype %i/%s', (sport, subSport) => {
      const input = fixture({ sport, subSport, withSubSport: subSport !== undefined });
      expect(prepareCOROSActivityFITUpload(input)).toBe(input);
    },
  );

  it.each([[4, 14], [18, 0]] as const)('preserves multi-session, mixed and malformed %i/%i files', (sport, subSport) => {
    const base = { sport, subSport, withSubSport: true };
    const corrupt = fixture(base); corrupt[corrupt.length - 1] ^= 1;
    const conflicting = fixture(base);
    const lap = readFitMessages(conflicting).messages.find(message => message.globalMessageNumber === 19)!;
    // The synthetic lap pattern identifies its classification bytes without private file data.
    const bytes = Buffer.concat(lap.fields.map(field => Buffer.from(field.bytes)));
    const offset = conflicting.indexOf(bytes);
    expect(offset).toBeGreaterThan(0);
    conflicting[offset + bytes.length - 1] = 20; repairCRC(conflicting);
    for (const input of [fixture({ ...base, sessionCount: 2 }), fixture({ ...base, malformedSport: true }), conflicting, corrupt]) {
      const before = Buffer.from(input);
      expect(prepareCOROSActivityFITUpload(input)).toBe(input);
      expect(input).toEqual(before);
    }
  });

  it('restores a missing summary without changing the semantic echo identity', async () => {
    const input = sessionlessFixture({ bigEndian: true, developer: true });
    const original = Buffer.from(input), output = prepareCOROSActivityFITUpload(input);
    expect(output).not.toBe(input);
    expect(input).toEqual(original);
    const sessions = readFitMessages(output).messages.filter(m => m.globalMessageNumber === 18);
    expect(sessions).toHaveLength(1);
    const [before, after] = await Promise.all([input, output].map(buildActivitySyncOutboundFingerprintIds));
    expect(before.fingerprintIds).toHaveLength(2);
    expect(after.fingerprintIds).toHaveLength(2);
    expect(after.exactFingerprintId).not.toBe(before.exactFingerprintId);
    expect(after.fingerprintIds[1]).toBe(before.fingerprintIds[1]);
    expect(prepareCOROSActivityFITUpload(output)).toBe(output);
  });

  it('applies the existing snorkeling mapping after shared Session recovery', () => {
    const input = sessionlessFixture({ sport: 82 });
    const output = prepareCOROSActivityFITUpload(input);
    const session = readFitMessages(output).messages.find(m => m.globalMessageNumber === 18)!;
    expect(session.fields.find(f => f.fieldNumber === 5)!.bytes[0]).toBe(5);
    expect(session.fields.find(f => f.fieldNumber === 6)!.bytes[0]).toBe(18);
  });

  it.each([[82, ActivityTypes.OpenWaterSwimming, true], [82, ActivityTypes.OpenWaterSwimming, false],
    [32, ActivityTypes.Generic, true], [29, ActivityTypes.Generic, true],
    [53, ActivityTypes.Generic, false], [53, ActivityTypes.Generic, true]] as const)(
    'sport %i parses as %s with original metrics (GPS=%s)', async (sport, expectedType, withGPS) => {
      const input = fixture({ sport, withGPS });
      const output = prepareCOROSActivityFITUpload(input);
      const parse = (file: Buffer) => EventImporterFIT.getFromArrayBuffer(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, createParsingOptions(),
      );
      const before = await parse(input), after = await parse(output);
      expect(after.getActivityTypesAsArray()).toEqual([expectedType]);
      expect(after.startDate).toEqual(before.startDate);
      expect(after.endDate).toEqual(before.endDate);
      expect(after.getActivities().map(activity => ({
        duration: activity.getDuration().getValue(), distance: activity.getDistance().getValue(),
      }))).toEqual(before.getActivities().map(activity => ({
        duration: activity.getDuration().getValue(), distance: activity.getDistance().getValue(),
      })));
    },
  );

  it.each([82, 32])('converts only the verified sport %i without mutating the original', sport => {
    const input = fixture({ sport, bigEndian: true, compressed: true, developer: true });
    const original = Buffer.from(input);
    const output = prepareCOROSActivityFITUpload(input);
    expect(output).toEqual(sport === 82 ? createCOROSSnorkelingFIT(input) : createCOROSSailingFIT(input));
    expect(input).toEqual(original);
    // A second preparation never remaps swimming/generic or copies it unnecessarily.
    expect(prepareCOROSActivityFITUpload(output)).toBe(output);
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])(
    'converts fishing while preserving all unrelated fields (big endian=%s, sub-sport present=%s)', (bigEndian, withSubSport) => {
      const input = fixture({ sport: 29, bigEndian, withSubSport, developer: true, compressed: true, compressedLap: true });
      const original = Buffer.from(input), output = prepareCOROSActivityFITUpload(input);
      expect(input).toEqual(original);
      expect(output).not.toEqual(input);
      const before = readFitMessages(input), after = readFitMessages(output);
      const categoryFields = new Map([[12, [0, 1]], [18, [5, 6]], [19, [25, 39]]]);
      const withoutCategory = (message: typeof before.messages[number]) => ({ ...message,
        fields: message.fields.filter(field => !(categoryFields.get(message.globalMessageNumber) ?? []).includes(field.fieldNumber)) });
      expect(after.issues).toEqual([]);
      expect(after.messages.map(withoutCategory)).toEqual(before.messages.map(withoutCategory));
      for (const message of after.messages) {
        for (const field of categoryFields.get(message.globalMessageNumber) ?? []) {
          expect(message.fields.find(value => value.fieldNumber === field)!.bytes).toEqual(Buffer.from([0]));
        }
      }
      expect(prepareCOROSActivityFITUpload(output)).toBe(output);
    },
  );

  it.each([[false, false], [false, true], [true, false], [true, true]])(
    'converts diving to generic while preserving depth and all other data (GPS=%s, big endian=%s)', (withGPS, bigEndian) => {
      const input = fixture({ sport: 53, withGPS, bigEndian, withDepth: true,
        withSubSport: bigEndian, developer: true, compressed: true, compressedLap: true });
      const original = Buffer.from(input), output = prepareCOROSActivityFITUpload(input);
      expect(input).toEqual(original);
      expect(output).not.toEqual(input);
      const before = readFitMessages(input), after = readFitMessages(output);
      const categoryFields = new Map([[12, [0, 1]], [18, [5, 6]], [19, [25, 39]]]);
      const withoutCategory = (message: typeof before.messages[number]) => ({ ...message,
        fields: message.fields.filter(field => !(categoryFields.get(message.globalMessageNumber) ?? []).includes(field.fieldNumber)) });
      expect(after.issues).toEqual([]);
      expect(after.messages.map(withoutCategory)).toEqual(before.messages.map(withoutCategory));
      const records = after.messages.filter(message => message.globalMessageNumber === 20);
      expect(records).toHaveLength(2);
      expect(records.every(message => message.fields.some(field => field.fieldNumber === 92))).toBe(true);
      expect(records.every(message => message.fields.some(field => field.fieldNumber === 0))).toBe(withGPS);
      for (const message of after.messages) {
        for (const field of categoryFields.get(message.globalMessageNumber) ?? []) {
          expect(message.fields.find(value => value.fieldNumber === field)!.bytes).toEqual(Buffer.from([0]));
        }
      }
      expect(prepareCOROSActivityFITUpload(output)).toBe(output);
    },
  );

  it.each([[29, 'fishing_to_gps_cardio'], [53, 'diving_to_generic']] as const)('logs only the fixed sport %i mapping label', (sport, mapping) => {
    vi.mocked(logger.info).mockClear();
    prepareCOROSActivityFITUpload(fixture({ sport }));
    expect(logger.info).toHaveBeenCalledExactlyOnceWith('[COROS] Applied activity FIT category fallback.', {
      mapping,
    });
  });

  it.each([0, 1, 2, 5, 81, 83, 85])('passes unrelated sport %i through byte-for-byte', sport => {
    const input = fixture({ sport });
    expect(prepareCOROSActivityFITUpload(input)).toBe(input);
  });

  it.each([false, true])('converts GPS-less snorkeling without adding samples (big endian=%s)', bigEndian => {
    const input = fixture({ withGPS: false, withSubSport: true, bigEndian, developer: true, compressed: true });
    const original = Buffer.from(input);
    const output = prepareCOROSActivityFITUpload(input);
    expect(output).toEqual(createCOROSSnorkelingFIT(input));
    expect(output).not.toEqual(input);
    expect(input).toEqual(original);
    const before = readFitMessages(input), after = readFitMessages(output);
    const categoryFields = new Map([[12, [0, 1]], [18, [5, 6]], [19, [25, 39]]]);
    const withoutCategory = (message: typeof before.messages[number]) => ({ ...message,
      fields: message.fields.filter(field => !(categoryFields.get(message.globalMessageNumber) ?? []).includes(field.fieldNumber)) });
    expect(after.issues).toEqual([]);
    expect(after.messages.map(withoutCategory)).toEqual(before.messages.map(withoutCategory));
    expect(prepareCOROSActivityFITUpload(output)).toBe(output);
  });

  it.each([32, 29])('keeps GPS-less outdoor sport %i unchanged', sport => {
    const input = fixture({ sport, withGPS: false });
    expect(prepareCOROSActivityFITUpload(input)).toBe(input);
  });

  it.each([82, 32, 29, 53])('leaves multisession and malformed sport %i unchanged', sport => {
    const corrupt = fixture({ sport }); corrupt[corrupt.length - 1] ^= 1;
    for (const input of [fixture({ sport, sessionCount: 2 }),
      fixture({ sport, malformedSport: true }), fixture({ sport, fullSessionDefinition: true }), corrupt]) {
      const original = Buffer.from(input);
      expect(prepareCOROSActivityFITUpload(input)).toBe(input);
      expect(input).toEqual(original);
    }
  });

  it.each([32, 29])('keeps outdoor sport %i with invalid coordinates unchanged', sport => {
    for (const coordinates of [[0x7fffffff, 1234], [1234, 0x7fffffff], [0x50000000, 1234]] as [number, number][]) {
      const input = fixture({ sport, coordinates });
      expect(prepareCOROSActivityFITUpload(input)).toBe(input);
    }
  });

  it('converts snorkeling with unavailable GPS without inventing coordinates', () => {
    const input = fixture({ coordinates: [0x7fffffff, 0x7fffffff] });
    const output = prepareCOROSActivityFITUpload(input);
    expect(output).toEqual(createCOROSSnorkelingFIT(input));
    expect(output).not.toEqual(input);
    expect(readFitMessages(output, { messageNumbers: [20] }).messages)
      .toEqual(readFitMessages(input, { messageNumbers: [20] }).messages);
  });

  it('accepts recorded zero coordinates and preserves their bytes', () => {
    const input = fixture({ coordinates: [0, 0] });
    const output = prepareCOROSActivityFITUpload(input);
    expect(output).not.toBe(input);
    expect(readFitMessages(output, { messageNumbers: [20] }).messages)
      .toEqual(readFitMessages(input, { messageNumbers: [20] }).messages);
  });

  it.each([82, 32, 29, 53])('leaves sport %i with a conflicting lap on the existing provider path', sport => {
    const input = fixture({ sport });
    const index = input.indexOf(Buffer.from([0, 0xe8, 3, 0, 0, sport, 7]));
    expect(index).toBeGreaterThan(0);
    input[index + 5] = 1; repairCRC(input);
    expect(prepareCOROSActivityFITUpload(input)).toBe(input);
  });
});

describe('COROS empty native field compatibility', () => {
  it('logs only the removal count, not workout data or identifiers', () => {
    vi.mocked(logger.info).mockClear();
    prepareCOROSActivityFITUpload(fixture({ sport: 1, emptyNativeFields: 'zero' }));
    expect(logger.info).toHaveBeenCalledExactlyOnceWith('[COROS] Removed empty activity FIT field definitions.', {
      removedFieldDefinitions: 2,
    });
  });

  it('changes the exact fingerprint while keeping the real parsed semantic fingerprint', async () => {
    const input = fixture({ sport: 1, emptyNativeFields: 'zero', developer: true, compressed: true });
    const output = prepareCOROSActivityFITUpload(input);
    const before = await buildActivitySyncOutboundFingerprintIds(input);
    const after = await buildActivitySyncOutboundFingerprintIds(output);
    expect(before.fingerprintIds).toHaveLength(2);
    expect(after.fingerprintIds).toHaveLength(2);
    expect(after.exactFingerprintId).not.toBe(before.exactFingerprintId);
    expect(after.fingerprintIds[1]).toBe(before.fingerprintIds[1]);
    expect(after.activityTypes).toEqual(before.activityTypes);
  });

  it('does not remove populated event data or lap cycles', () => {
    const input = fixture({ sport: 1, emptyNativeFields: 'populated' });
    expect(prepareCOROSActivityFITUpload(input)).toBe(input);
    const messages = readFitMessages(input).messages;
    for (const [global, number] of [[21, 3], [19, 10]]) {
      expect(messages.find(message => message.globalMessageNumber === global)!
        .fields.find(field => field.fieldNumber === number)!.bytes).toEqual(Buffer.from([17, 0, 0, 0]));
    }
  });

  it.each([12, 14] as const)('removes only the two empty triplets with a %i-byte header', headerSize => {
    const input = fixture({ sport: 1, headerSize, emptyNativeFields: 'zero' });
    const original = Buffer.from(input);
    expect(() => readFitMessages(input)).toThrow('invalid_structure');
    const output = prepareCOROSActivityFITUpload(input);
    expect(output).toEqual(fixture({ sport: 1, headerSize, emptyNativeFields: 'omitted' }));
    expect(output.length).toBe(input.length - 6);
    expect(input).toEqual(original);
    expect(readFitMessages(output).issues).toEqual([]);
    expect(prepareCOROSActivityFITUpload(output)).toBe(output);
  });

  it.each([false, true])('preserves data, developer fields and compressed headers (big endian=%s)', bigEndian => {
    const options = { sport: 1, bigEndian, developer: true, compressed: true, compressedLap: true };
    const input = fixture({ ...options, emptyNativeFields: 'zero' });
    const expected = fixture({ ...options, emptyNativeFields: 'omitted' });
    expect(prepareCOROSActivityFITUpload(input)).toEqual(expected);
    expect(readFitMessages(expected).messages.filter(message => message.globalMessageNumber === 19)).toHaveLength(2);
  });

  it('handles repeated local definitions without changing their data records', () => {
    const input = fixture({ sport: 1, emptyNativeFields: 'zero', eventCount: 1000 });
    const output = prepareCOROSActivityFITUpload(input);
    expect(output).toEqual(fixture({ sport: 1, emptyNativeFields: 'omitted', eventCount: 1000 }));
    expect(output.length).toBe(input.length - 3 * 1001);
  });

  it.each([1, 2, 3, 7, 15] as const)('preserves nonzero local message slot %i', localMessageNumber => {
    const options = { sport: 1, localMessageNumber, developer: true,
      compressed: localMessageNumber < 4, compressedLap: localMessageNumber < 4 };
    expect(prepareCOROSActivityFITUpload(fixture({ ...options, emptyNativeFields: 'zero' })))
      .toEqual(fixture({ ...options, emptyNativeFields: 'omitted' }));
  });

  it.each([false, true])('preserves data when an empty triplet comes first or in the middle (big endian=%s)', bigEndian => {
    const options = { sport: 1, bigEndian, developer: true, compressedLap: true };
    for (const [global, count, number] of [[21, 4, 3], [19, 5, 10]]) {
      for (const position of [0, 2]) {
        const input = fixture({ ...options, emptyNativeFields: 'zero' });
        const definition = input.indexOf(Buffer.from([0x60, 0, bigEndian ? 1 : 0,
          ...(bigEndian ? [0, global] : [global, 0]), count]));
        expect(definition).toBeGreaterThan(0);
        const emptyOffset = definition + 6 + (count - 1) * 3;
        const insertAt = definition + 6 + position * 3;
        expect(input.subarray(emptyOffset, emptyOffset + 3)).toEqual(Buffer.from([number, 0, 0x86]));
        input.copy(input, insertAt + 3, insertAt, emptyOffset);
        Buffer.from([number, 0, 0x86]).copy(input, insertAt);
        repairCRC(input);
        const original = Buffer.from(input);
        expect(prepareCOROSActivityFITUpload(input)).toEqual(fixture({ ...options, emptyNativeFields: 'omitted' }));
        expect(input).toEqual(original);
      }
    }
  });

  it('refuses malformed data after eligible empty definitions instead of returning a partial repair', () => {
    const compressed = fixture({ sport: 1, emptyNativeFields: 'zero', compressedLap: true });
    const header = compressed.indexOf(Buffer.from([0x85, 1, 7]));
    expect(header).toBeGreaterThan(0);
    compressed[header] = 0xa5; repairCRC(compressed); // Undeclared local slot 1, after both empty definitions.
    const complete = fixture({ sport: 1, emptyNativeFields: 'zero' });
    const truncated = Buffer.concat([complete.subarray(0, -3), Buffer.alloc(2)]);
    truncated.writeUInt32LE(truncated.length - truncated[0] - 2, 4); repairCRC(truncated);
    for (const input of [compressed, truncated]) {
      const original = Buffer.from(input);
      vi.mocked(logger.info).mockClear();
      expect(prepareCOROSActivityFITUpload(input)).toBe(input);
      expect(input).toEqual(original);
      expect(logger.info).not.toHaveBeenCalled();
    }
  });

  it.each([82, 32, 29, 53])('repairs before applying the existing sport %i mapping', sport => {
    const input = fixture({ sport, emptyNativeFields: 'zero' });
    const clean = fixture({ sport, emptyNativeFields: 'omitted' });
    expect(prepareCOROSActivityFITUpload(input)).toEqual(prepareCOROSActivityFITUpload(clean));
  });

  it('repairs GPS-less sailing without changing its category or adding GPS', () => {
    const input = fixture({ sport: 32, withGPS: false, emptyNativeFields: 'zero' });
    expect(prepareCOROSActivityFITUpload(input))
      .toEqual(fixture({ sport: 32, withGPS: false, emptyNativeFields: 'omitted' }));
  });

  it.each([[2, 0x86], [3, 0x85], [0, 0x86]])(
    'does not repair an unknown, mistyped or duplicate empty event field %i/%i', (number, baseType) => {
      const input = fixture({ sport: 1, emptyNativeFields: 'zero' });
      const offset = input.indexOf(Buffer.from([3, 0, 0x86]));
      expect(offset).toBeGreaterThan(0);
      input[offset] = number; input[offset + 2] = baseType; repairCRC(input);
      const original = Buffer.from(input);
      expect(prepareCOROSActivityFITUpload(input)).toBe(input);
      expect(input).toEqual(original);
    },
  );

  it.each([0, 2])('does not construct a summary for a %i-session file', sessionCount => {
    const input = fixture({ sport: 1, sessionCount, emptyNativeFields: 'zero' });
    expect(prepareCOROSActivityFITUpload(input)).toBe(input);
  });

  it('does not hide malformed nonempty or developer definitions', () => {
    const invalidType = fixture({ sport: 1, emptyNativeFields: 'zero' });
    const typeOffset = invalidType.indexOf(Buffer.from([9, 4, 13]));
    expect(typeOffset).toBeGreaterThan(0);
    invalidType[typeOffset + 2] = 0x89; repairCRC(invalidType); // A four-byte field cannot contain float64.
    const invalidTimestamp = fixture({ sport: 1, emptyNativeFields: 'zero' });
    const timestampOffset = invalidTimestamp.indexOf(Buffer.from([253, 4, 0x86]));
    expect(timestampOffset).toBeGreaterThan(0);
    invalidTimestamp[timestampOffset + 2] = 0x85; repairCRC(invalidTimestamp);
    const emptyDeveloper = fixture({ sport: 1, emptyNativeFields: 'zero', developer: true });
    const developerOffset = emptyDeveloper.indexOf(Buffer.from([1, 7, 3, 0]));
    expect(developerOffset).toBeGreaterThan(0);
    emptyDeveloper[developerOffset + 2] = 0; repairCRC(emptyDeveloper);
    for (const input of [invalidType, invalidTimestamp, emptyDeveloper]) expect(prepareCOROSActivityFITUpload(input)).toBe(input);
  });

  it('does not repair a non-activity, corrupt, truncated or oversized file', () => {
    const nonActivity = fixture({ sport: 1, emptyNativeFields: 'zero' });
    nonActivity[nonActivity[0] + 13] = 6; repairCRC(nonActivity);
    const corruptFile = fixture({ sport: 1, emptyNativeFields: 'zero' });
    corruptFile[corruptFile.length - 1] ^= 1;
    const corruptHeader = fixture({ sport: 1, emptyNativeFields: 'zero' });
    corruptHeader[12] ^= 1;
    for (const input of [nonActivity, corruptFile, corruptHeader, corruptFile.subarray(0, -3),
      Buffer.alloc(30 * 1024 * 1024 + 1)]) {
      expect(prepareCOROSActivityFITUpload(input)).toBe(input);
    }
  });
});
