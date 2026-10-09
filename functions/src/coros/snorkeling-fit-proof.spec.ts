import { FitEncoder } from 'fit-file-parser/encoder';
import { getFitSportName, getFitSubSportName } from 'fit-file-parser/profile';
import { readFitMessages } from 'fit-file-parser/raw';
import { createCOROSSnorkelingFITProof } from './snorkeling-fit-proof';

type Field = [number, number, Buffer];

// Entirely synthetic FIT structures: no production files, identifiers or samples.
function fixture(options: {
  headerSize?: 12 | 14; bigEndian?: boolean; sport?: number; sessionCount?: number;
  withSubSport?: boolean; developer?: boolean; compressed?: boolean; withGPS?: boolean;
} = {}): Buffer {
  const parts: Buffer[] = [];
  const u16 = (value: number) => {
    const b = Buffer.alloc(2);
    if (options.bigEndian) b.writeUInt16BE(value); else b.writeUInt16LE(value);
    return b;
  };
  const u32 = (value: number) => {
    const b = Buffer.alloc(4);
    if (options.bigEndian) b.writeUInt32BE(value); else b.writeUInt32LE(value);
    return b;
  };
  const message = (global: number, fields: Field[], developer = false, compressed = false) => {
    parts.push(Buffer.concat([Buffer.from([developer ? 0x60 : 0x40, 0, options.bigEndian ? 1 : 0]),
      u16(global), Buffer.from([fields.length]), ...fields.map(([n, t, b]) => Buffer.from([n, b.length, t])),
      ...(developer ? [Buffer.from([1, 7, 3, 0])] : [])]));
    parts.push(Buffer.concat([Buffer.from([0]), ...fields.map(field => field[2]),
      ...(developer ? [Buffer.from([0xa1, 0xb2, 0xc3])] : [])]));
    if (compressed) parts.push(Buffer.concat([Buffer.from([0x85]),
      ...fields.filter(field => field[0] !== 253).map(field => field[2])]));
  };
  const category: Field[] = options.withSubSport ? [[6, 0, Buffer.from([0])]] : [];
  message(0, [[0, 0, Buffer.from([4])], [1, 0x84, u16(23)]]);
  message(20, [[253, 0x86, u32(1000)], [3, 2, Buffer.from([120])],
    ...(options.withGPS === false ? [] : [[0, 0x85, u32(1234)], [1, 0x85, u32(5678)]] as Field[])], false, options.compressed);
  // Same local slot is redefined repeatedly, including an opaque vendor message.
  message(65280, [[9, 13, Buffer.from([11, 22, 33, 44])]], options.developer);
  message(12, [[0, 0, Buffer.from([options.sport ?? 82])], [3, 7, Buffer.from('Snorkel\0')],
    ...(options.withSubSport ? [[1, 0, Buffer.from([0])]] as Field[] : [])]);
  message(19, [[253, 0x86, u32(1000)], [25, 0, Buffer.from([options.sport ?? 82])],
    [26, 2, Buffer.from([7])], [7, 0x86, u32(90000)],
    ...(options.withSubSport ? [[39, 0, Buffer.from([0])]] as Field[] : [])], options.developer);
  for (let i = 0; i < (options.sessionCount ?? 1); i++) {
    message(18, [[253, 0x86, u32(1000)], [2, 0x86, u32(910)], [5, 0, Buffer.from([options.sport ?? 82])],
      ...category, [7, 0x86, u32(90000)], [9, 0x86, u32(123456)],
      [200, 13, Buffer.from([0xde, 0xad, 0xbe, 0xef])]], options.developer);
  }
  message(34, [[1, 0x84, u16(options.sessionCount ?? 1)]]);
  const data = Buffer.concat(parts), header = Buffer.alloc(options.headerSize ?? 14);
  header[0] = header.length; header[1] = 0x20; header.writeUInt16LE(21176, 2);
  header.writeUInt32LE(data.length, 4); header.write('.FIT', 8);
  if (header.length === 14) header.writeUInt16LE(FitEncoder.calculateCRC(header.subarray(0, 12)), 12);
  const content = Buffer.concat([header, data]), crc = Buffer.alloc(2);
  crc.writeUInt16LE(FitEncoder.calculateCRC(content));
  return Buffer.concat([content, crc]);
}

function repairCRC(file: Buffer): Buffer {
  if (file[0] === 14) file.writeUInt16LE(FitEncoder.calculateCRC(file.subarray(0, 12)), 12);
  file.writeUInt16LE(FitEncoder.calculateCRC(file.subarray(0, -2)), file.length - 2);
  return file;
}

describe('COROS local snorkeling FIT proof (not enabled for uploads)', () => {
  it.each([12, 14] as const)('adds missing sub_sport using a valid %i-byte header', headerSize => {
    const input = fixture({ headerSize }), before = Buffer.from(input);
    const output = createCOROSSnorkelingFITProof(input);
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
    const output = createCOROSSnorkelingFITProof(input);
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
    const output = createCOROSSnorkelingFITProof(input);
    const before = readFitMessages(input), after = readFitMessages(output);
    expect(after.messages.map(m => m.developerFields)).toEqual(before.messages.map(m => m.developerFields));
    expect(after.messages.find(m => m.globalMessageNumber === 19)!.fields.find(f => f.fieldNumber === 26)!.bytes[0]).toBe(7);
    expect(after.messages.filter(m => m.globalMessageNumber === 20)).toEqual(before.messages.filter(m => m.globalMessageNumber === 20));
  });

  it('does not invent missing GPS or swimming metrics', () => {
    const input = fixture({ withGPS: false });
    const output = createCOROSSnorkelingFITProof(input);
    expect(readFitMessages(output).messages.filter(m => m.globalMessageNumber === 20))
      .toEqual(readFitMessages(input).messages.filter(m => m.globalMessageNumber === 20));
    expect(readFitMessages(output).messages.find(m => m.globalMessageNumber === 18)!.fields.map(f => f.fieldNumber).sort())
      .toEqual([253, 2, 5, 6, 7, 9, 200].sort());
  });

  it.each([1, 2, 5, 32, 53, 81, 83])('refuses non-snorkeling sport %i, including sailing/diving', sport => {
    const input = fixture({ sport }), before = Buffer.from(input);
    expect(() => createCOROSSnorkelingFITProof(input)).toThrow('single-session snorkeling');
    expect(input).toEqual(before);
  });

  it.each([0, 2])('refuses %i-session files', sessionCount => {
    expect(() => createCOROSSnorkelingFITProof(fixture({ sessionCount }))).toThrow('single-session snorkeling');
  });

  it('refuses a conflicting lap sport without mutating its input', () => {
    const input = fixture();
    const pattern = Buffer.from([0, 0xe8, 3, 0, 0, 82, 7]);
    const index = input.indexOf(pattern);
    expect(index).toBeGreaterThan(0);
    input[index + 5] = 1; repairCRC(input);
    expect(() => createCOROSSnorkelingFITProof(input)).toThrow('conflicting FIT sport');
  });

  it('refuses a non-activity file', () => {
    const input = fixture(); input[input[0] + 13] = 6; repairCRC(input);
    expect(() => createCOROSSnorkelingFITProof(input)).toThrow('single-session snorkeling');
  });

  it('refuses corrupt, truncated and oversized input rather than repairing it', () => {
    const corrupt = fixture(); corrupt[corrupt.length - 1] ^= 1;
    expect(() => createCOROSSnorkelingFITProof(corrupt)).toThrow('invalid_crc');
    expect(() => createCOROSSnorkelingFITProof(fixture().subarray(0, -3))).toThrow('invalid_header');
    expect(() => createCOROSSnorkelingFITProof(Buffer.alloc(30 * 1024 * 1024 + 1))).toThrow('input_limit');
  });
});
