import { FitEncoder } from 'fit-file-parser';

/** Synthetic FIT with real developer definitions and NUL-separated session arrays. */
export function suuntoFitFixture(owners: string[], externalIds: string[], exporter = 'SuuntoFitExport1', bigEndian = false): Buffer {
  const parts: Buffer[] = [];
  const word = (n: number) => { const value = Buffer.alloc(2); if (bigEndian) value.writeUInt16BE(n); else value.writeUInt16LE(n); return value; };
  const message = (global: number, fields: Array<[number, number, Buffer]>, developers: Array<[number, number, Buffer]> = []) => {
    parts.push(Buffer.concat([Buffer.from([developers.length ? 0x60 : 0x40, 0, bigEndian ? 1 : 0]), word(global), Buffer.from([fields.length]),
      ...fields.map(([id, type, value]) => Buffer.from([id, value.length, type])),
      ...(developers.length ? [Buffer.from([developers.length]), ...developers.map(([id, index, value]) => Buffer.from([id, value.length, index]))] : [])]));
    parts.push(Buffer.concat([Buffer.from([0]), ...fields.map(f => f[2]), ...developers.map(f => f[2])]));
  };
  message(207, [[3, 2, Buffer.from([0])], [1, 13, Buffer.from(exporter)]]);
  for (const [number, name] of [[2, 'suuntoplus_plugin_owner_id'], [3, 'suuntoplus_plugin_external_id']] as const) {
    message(206, [[0, 2, Buffer.from([0])], [1, 2, Buffer.from([number])], [2, 2, Buffer.from([7])], [3, 7, Buffer.from(`${name}\0`)]]);
  }
  const start = Buffer.alloc(4); if (bigEndian) start.writeUInt32BE(123); else start.writeUInt32LE(123);
  message(18, [[2, 134, start]], [[2, 0, Buffer.from(`${owners.join('\0')}\0`)], [3, 0, Buffer.from(`${externalIds.join('\0')}\0`)]]);
  const data = Buffer.concat(parts); const header = Buffer.alloc(12); header[0] = 12; header[1] = 0x20;
  header.writeUInt32LE(data.length, 4); header.write('.FIT', 8);
  const all = Buffer.concat([header, data]); const crc = Buffer.alloc(2); crc.writeUInt16LE(FitEncoder.calculateCRC(all));
  return Buffer.concat([all, crc]);
}
