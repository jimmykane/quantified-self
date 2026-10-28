import { FitEncoder } from 'fit-file-parser';

/** Synthetic observed Wahoo app message, never an exported account FIT. */
export function wahooTrainingFitFixture(options: {
  planId?: string; workoutId?: number | null; startTimeMs?: number;
  referenceCount?: number; sessionCount?: number; referenceStartOffsetSeconds?: number;
} = {}): Buffer {
  const start = ((options.startTimeMs ?? Date.parse('2026-09-17T07:00:00Z')) - Date.UTC(1989, 11, 31)) / 1000;
  const parts: Buffer[] = [];
  const u16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
  const u32 = (value: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
  const message = (global: number, fields: Array<[number, number, Buffer]>) => {
    parts.push(Buffer.concat([Buffer.from([0x40, 0, 0]), u16(global), Buffer.from([fields.length]),
      ...fields.map(([number, type, bytes]) => Buffer.from([number, bytes.length, type]))]));
    parts.push(Buffer.concat([Buffer.from([0]), ...fields.map(field => field[2])]));
  };
  message(0, [[0, 0, Buffer.from([4])], [1, 0x84, u16(32)]]);
  const payload = Buffer.concat([Buffer.from([0x35, 0, 5]), Buffer.from(options.planId ?? '789'),
    Buffer.from([0, 0, 14, 0]), u32(options.workoutId === null ? 0xffffffff : options.workoutId ?? 456),
    Buffer.from([0]), u32(123)]);
  for (let i = 0; i < (options.referenceCount ?? 1); i++) {
    message(65285, [[0, 0x86, u32(start + (options.referenceStartOffsetSeconds ?? 0))],
      [1, 2, Buffer.from([255])], [2, 2, Buffer.from([payload.length])], [3, 13, payload]]);
  }
  for (let i = 0; i < (options.sessionCount ?? 1); i++) message(18, [[2, 0x86, u32(start + i)]]);
  const data = Buffer.concat(parts); const header = Buffer.alloc(12);
  header[0] = 12; header[1] = 0x20; header.writeUInt32LE(data.length, 4); header.write('.FIT', 8);
  const content = Buffer.concat([header, data]);
  return Buffer.concat([content, u16(FitEncoder.calculateCRC(content))]);
}
