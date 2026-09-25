import { FitEncoder } from 'fit-file-parser';

/** Synthetic FIT with real developer definitions and NUL-separated session arrays. */
export function suuntoFitFixture(owners: string[], externalIds: string[], exporter = 'SuuntoFitExport1', bigEndian = false): Buffer {
  return suuntoMultiSessionFitFixture([{ owners, externalIds }], exporter, bigEndian);
}

/** Synthetic multi-session FIT. Each developer string remains within FIT's
 * one-byte field-size boundary, while the complete file can carry many Guides. */
export function suuntoMultiSessionFitFixture(
  sessions: Array<{ owners: string[]; externalIds: string[] }>,
  exporter = 'SuuntoFitExport1',
  bigEndian = false,
): Buffer {
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
  sessions.forEach((session, index) => {
    const start = Buffer.alloc(4);
    if (bigEndian) start.writeUInt32BE(123 + index); else start.writeUInt32LE(123 + index);
    message(18, [[2, 134, start]], [
      [2, 0, Buffer.from(`${session.owners.join('\0')}\0`)],
      [3, 0, Buffer.from(`${session.externalIds.join('\0')}\0`)],
    ]);
  });
  const data = Buffer.concat(parts); const header = Buffer.alloc(12); header[0] = 12; header[1] = 0x20;
  header.writeUInt32LE(data.length, 4); header.write('.FIT', 8);
  const all = Buffer.concat([header, data]); const crc = Buffer.alloc(2); crc.writeUInt16LE(FitEncoder.calculateCRC(all));
  return Buffer.concat([all, crc]);
}

/** Synthetic standard FIT training_file + workout messages for consumer tests. */
export function standardWorkoutReferenceFitFixture(withTrainingFile = true): Buffer {
  const parts: Buffer[] = [];
  const message = (global: number, fields: Array<[number, number, Buffer]>) => {
    const globalNumber = Buffer.alloc(2); globalNumber.writeUInt16LE(global);
    parts.push(Buffer.concat([Buffer.from([0x40, 0, 0]), globalNumber, Buffer.from([fields.length]),
      ...fields.map(([number, type, value]) => Buffer.from([number, value.length, type]))]));
    parts.push(Buffer.concat([Buffer.from([0]), ...fields.map(field => field[2])]));
  };
  const uint16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
  const uint32 = (value: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
  if (withTrainingFile) message(72, [
    [0, 0, Buffer.from([5])],
    [1, 0x84, uint16(1)],
    [2, 0x84, uint16(2)],
    [3, 0x8c, uint32(0xfffffffe)],
    [4, 0x86, uint32(123)],
    [253, 0x86, uint32(124)],
  ]);
  message(26, [
    [8, 7, Buffer.from('Intervals\0')],
    [4, 0, Buffer.from([2])],
    [11, 0, Buffer.from([8])],
    [6, 0x84, uint16(4)],
  ]);
  const data = Buffer.concat(parts); const header = Buffer.alloc(12); header[0] = 12; header[1] = 0x20;
  header.writeUInt32LE(data.length, 4); header.write('.FIT', 8);
  const all = Buffer.concat([header, data]); const crc = Buffer.alloc(2); crc.writeUInt16LE(FitEncoder.calculateCRC(all));
  return Buffer.concat([all, crc]);
}
