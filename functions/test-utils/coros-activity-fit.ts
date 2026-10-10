import { FitEncoder } from 'fit-file-parser/encoder';

type Field = [number, number, Buffer];

// Entirely synthetic FIT structures: no production files, identifiers or samples.
export function createCOROSActivityFITFixture(options: {
  headerSize?: 12 | 14; bigEndian?: boolean; sport?: number; sessionCount?: number;
  withSubSport?: boolean; developer?: boolean; compressed?: boolean; withGPS?: boolean;
  coordinates?: [number, number]; compressedLap?: boolean; fullSessionDefinition?: boolean; malformedSport?: boolean;
  emptyNativeFields?: 'zero' | 'omitted' | 'populated'; eventCount?: number;
  localMessageNumber?: 0 | 1 | 2 | 3 | 7 | 15;
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
    const local = options.localMessageNumber ?? 0;
    parts.push(Buffer.concat([Buffer.from([(developer ? 0x60 : 0x40) | local, 0, options.bigEndian ? 1 : 0]),
      u16(global), Buffer.from([fields.length]), ...fields.map(([n, t, b]) => Buffer.from([n, b.length, t])),
      ...(developer ? [Buffer.from([1, 7, 3, 0])] : [])]));
    parts.push(Buffer.concat([Buffer.from([local]), ...fields.map(field => field[2]),
      ...(developer ? [Buffer.from([0xa1, 0xb2, 0xc3])] : [])]));
    if (compressed) parts.push(Buffer.concat([Buffer.from([0x85 | (local << 5)]),
      ...fields.filter(field => field[0] !== 253).map(field => field[2]),
      ...(developer ? [Buffer.from([0xa1, 0xb2, 0xc3])] : [])]));
  };
  const category: Field[] = options.withSubSport ? [[6, 0, Buffer.from([0])]] : [];
  message(0, [[0, 0, Buffer.from([4])], [1, 0x84, u16(23)]]);
  message(20, [[253, 0x86, u32(1000)], [3, 2, Buffer.from([120])],
    ...(options.withGPS === false ? [] : [[0, 0x85, u32(options.coordinates?.[0] ?? 1234)], [1, 0x85, u32(options.coordinates?.[1] ?? 5678)]] as Field[])], false, options.compressed);
  // Same local slot is redefined repeatedly, including an opaque vendor message.
  message(65280, [[9, 13, Buffer.from([11, 22, 33, 44])]], options.developer);
  message(12, [[0, 0, Buffer.from([options.sport ?? 82])], [3, 7, Buffer.from('Snorkel\0')],
    ...(options.withSubSport ? [[1, 0, Buffer.from([0])]] as Field[] : [])]);
  if (options.emptyNativeFields) {
    for (let i = 0; i < (options.eventCount ?? 1); i++) {
      message(21, [[253, 0x86, u32(1000)], [0, 0, Buffer.from([0])], [1, 0, Buffer.from([0])],
        ...(options.emptyNativeFields === 'omitted' ? [] : [[3, 0x86,
          options.emptyNativeFields === 'zero' ? Buffer.alloc(0) : u32(17)]] as Field[])], options.developer);
    }
  }
  message(19, [[253, 0x86, u32(1000)], [25, 0, Buffer.from([options.sport ?? 82])],
    [26, 2, Buffer.from([7])], [7, 0x86, u32(90000)],
    ...(!options.emptyNativeFields || options.emptyNativeFields === 'omitted' ? [] : [[10, 0x86,
      options.emptyNativeFields === 'zero' ? Buffer.alloc(0) : u32(17)]] as Field[]),
    ...(options.withSubSport ? [[39, 0, Buffer.from([0])]] as Field[] : [])], options.developer, options.compressedLap);
  for (let i = 0; i < (options.sessionCount ?? 1); i++) {
    const extraFields: Field[] = options.fullSessionDefinition
      ? Array.from({ length: 256 }, (_, n) => n).filter(n => ![253, 2, 5, 6, 7, 9, 200].includes(n))
        .map(n => [n, 13, Buffer.from([0])])
      : [];
    message(18, [[253, 0x86, u32(1000)], [2, 0x86, u32(910)],
      [5, 0, Buffer.from(options.malformedSport ? [82, 82] : [options.sport ?? 82])],
      ...category, [7, 0x86, u32(90000)], [9, 0x86, u32(123456)],
      [200, 13, Buffer.from([0xde, 0xad, 0xbe, 0xef])], ...extraFields], options.developer);
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
