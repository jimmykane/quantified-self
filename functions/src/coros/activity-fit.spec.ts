import { FitEncoder } from 'fit-file-parser/encoder';
import { getFitSportName, getFitSubSportName } from 'fit-file-parser/profile';
import { readFitMessages } from 'fit-file-parser/raw';
import { ActivityTypes, EventImporterFIT } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import { createParsingOptions } from '../../../shared/parsing-options';
import { buildActivitySyncOutboundFingerprintIds } from '../activity-sync/outbound-fingerprint';
import { createCOROSSailingFIT, createCOROSSnorkelingFIT, prepareCOROSActivityFITUpload } from './activity-fit';
import { createCOROSActivityFITFixture as fixture } from '../../test-utils/coros-activity-fit';

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
  it.each([[82, ActivityTypes.OpenWaterSwimming, true], [82, ActivityTypes.OpenWaterSwimming, false],
    [32, ActivityTypes.Generic, true]] as const)(
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

  it.each([0, 1, 2, 5, 81, 83])('passes unrelated sport %i through byte-for-byte', sport => {
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

  it('keeps GPS-less sailing unchanged', () => {
    const input = fixture({ sport: 32, withGPS: false });
    expect(prepareCOROSActivityFITUpload(input)).toBe(input);
  });

  it.each([82, 32])('leaves multisession and malformed sport %i unchanged', sport => {
    const corrupt = fixture({ sport }); corrupt[corrupt.length - 1] ^= 1;
    for (const input of [fixture({ sport, sessionCount: 2 }),
      fixture({ sport, malformedSport: true }), fixture({ sport, fullSessionDefinition: true }), corrupt]) {
      const original = Buffer.from(input);
      expect(prepareCOROSActivityFITUpload(input)).toBe(input);
      expect(input).toEqual(original);
    }
  });

  it.each([[0x7fffffff, 1234], [1234, 0x7fffffff], [0x50000000, 1234]])(
    'keeps sailing with invalid coordinates %s/%s unchanged', (latitude, longitude) => {
      const input = fixture({ sport: 32, coordinates: [latitude, longitude] });
      expect(prepareCOROSActivityFITUpload(input)).toBe(input);
    },
  );

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

  it('leaves a conflicting lap classification on the existing provider path', () => {
    const input = fixture();
    const index = input.indexOf(Buffer.from([0, 0xe8, 3, 0, 0, 82, 7]));
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

  it.each([82, 32])('repairs before applying the existing sport %i mapping', sport => {
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
