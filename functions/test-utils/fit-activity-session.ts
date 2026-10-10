import { FitEncoder } from 'fit-file-parser/encoder';

// Provider-shaped structure, invented values only. No retained production FIT.
export function sessionlessFixture(options: {
  bigEndian?: boolean; headerSize?: 12 | 14; declaredCount?: number; sport?: number;
  secondSport?: number; secondStart?: number; omitField?: number; extraTimer?: boolean;
  existingSession?: boolean; footerFirst?: boolean; invalidType?: boolean; overflow?: boolean;
  compressed?: boolean; developer?: boolean; indexed?: boolean;
  firstRecordTime?: number; lastRecordTime?: number; noRecords?: boolean; leadingVendor?: boolean;
  activityType?: number; activityTimer?: number; lapElapsed?: number; lapTimer?: number;
  recordField?: { type: number; bytes: Buffer }; vendorField?: { type: number; bytes: Buffer };
} = {}): Buffer {
  type F = [number, number, number | Buffer];
  const parts: Buffer[] = [];
  const u16 = (n: number) => { const b = Buffer.alloc(2); if (options.bigEndian) b.writeUInt16BE(n); else b.writeUInt16LE(n); return b; };
  const u32 = (n: number) => { const b = Buffer.alloc(4); if (options.bigEndian) b.writeUInt32BE(n); else b.writeUInt32LE(n); return b; };
  const message = (global: number, fields: F[], developer = false, compressed = false) => {
    const converted = fields.map(([n, type, v]) => [n, type, Buffer.isBuffer(v) ? v
      : [0, 2, 13].includes(type) ? Buffer.from([v]) : type === 0x84 ? u16(v) : u32(v)] as const);
    parts.push(Buffer.concat([Buffer.from([developer ? 0x6f : 0x4f, 0, options.bigEndian ? 1 : 0]), u16(global),
      Buffer.from([converted.length]), ...converted.map(([n, type, v]) => Buffer.from([n, v.length, type])),
      ...(developer ? [Buffer.from([1, 7, 3, 0])] : []), Buffer.from([15]), ...converted.map(f => f[2]),
      ...(developer ? [Buffer.from([0xaa, 0xbb, 0xcc])] : [])]));
    if (compressed) {
      // Define a separate compressed-capable local slot for another record.
      parts.push(Buffer.concat([Buffer.from([0x43, 0, options.bigEndian ? 1 : 0]), u16(global),
        Buffer.from([converted.length]), ...converted.map(([n, type, v]) => Buffer.from([n, v.length, type])),
        Buffer.from([0xe9]), ...converted.filter(f => f[0] !== 253).map(f => f[2])]));
    }
  };
  const footer = () => message(34, [[253, 0x86, 1400], [1, 0x84, options.declaredCount ?? 2],
    [2, 0, options.activityType ?? 0], [3, 0, 26], [4, 0, 1], [5, 0x86, 5000], [200, 13, Buffer.from([8, 7, 6])],
    ...(options.activityTimer === undefined ? [] : [[0, 0x86, options.activityTimer] as F])], !!options.developer);
  if (options.leadingVendor) message(65280, [[200, 13, Buffer.from([1])]]);
  message(0, [[0, 0, options.invalidType ? 6 : 4], [1, 0x84, 255]]);
  if (options.footerFirst) footer();
  message(21, [[253, 0x86, 1000], [0, 0, 0], [1, 0, 0]]);
  if (!options.noRecords) message(20, [[253, 0x86, options.firstRecordTime ?? 1000],
    [3, options.recordField?.type ?? 2, options.recordField?.bytes ?? 120], [5, 0x86, 0]], false, options.compressed);
  message(65280, [[200, options.vendorField?.type ?? 13, options.vendorField?.bytes ?? Buffer.from([1, 2, 3, 4])]], !!options.developer);
  for (const i of [0, 1]) {
    const fields: F[] = [[253, 0x86, 1200 + i * 200], [2, 0x86, i ? options.secondStart ?? 1200 : 1000],
      [7, 0x86, options.lapElapsed ?? 200000], [8, 0x86, options.lapTimer ?? 199000], [9, 0x86, options.overflow ? 0xfffffffe : 50000 + i * 20000],
      [11, 0x84, 20 + i * 10], [25, 0, i ? options.secondSport ?? options.sport ?? 5 : options.sport ?? 5],
      [39, 0, 18], [200, 13, Buffer.from([9, 8, 7, 6])]];
    if (options.indexed) fields.push([254, 0x84, i]);
    message(19, fields.filter(f => f[0] !== options.omitField), !!options.developer);
  }
  if (options.extraTimer) message(21, [[253, 0x86, 1250], [0, 0, 0], [1, 0, 0]]);
  if (!options.noRecords) message(20, [[253, 0x86, options.lastRecordTime ?? 1399], [3, 2, 140], [5, 0x86, 120000]]);
  message(21, [[253, 0x86, 1400], [0, 0, 0], [1, 0, 1]]);
  if (options.existingSession) message(18, [[253, 0x86, 1400], [5, 0, 5]]);
  if (!options.footerFirst) footer();
  const data = Buffer.concat(parts), header = Buffer.alloc(options.headerSize ?? 14);
  header[0] = header.length; header[1] = 0x20; header.writeUInt16LE(21176, 2);
  header.writeUInt32LE(data.length, 4); header.write('.FIT', 8);
  if (header.length === 14) header.writeUInt16LE(FitEncoder.calculateCRC(header.subarray(0, 12)), 12);
  const output = Buffer.concat([header, data, Buffer.alloc(2)]);
  output.writeUInt16LE(FitEncoder.calculateCRC(output.subarray(0, -2)), output.length - 2);
  return output;
}
