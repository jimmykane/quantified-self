import { FitBaseType as T, FitEncoder, FitEncoderField } from 'fit-file-parser/encoder';
import { FitRawMessage, readFitMessages, readFitUnsignedField } from 'fit-file-parser/raw';
import { getFitSportName } from 'fit-file-parser/profile';
import { MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES } from './activity-processing-config';

/** Repairs an outgoing copy only; the retained recording must never be replaced. */
export class FitActivitySessionRepair {
  /**
   * Recover one missing Session from contiguous, same-sport Lap summaries under
   * one complete timer. Ambiguous/multisport/corrupt recordings pass through.
   * Native/developer records remain byte-for-byte, including the original laps.
   */
  static createCopy(input: Buffer): Buffer {
    try {
      return this.repair(input);
    } catch {
      return input;
    }
  }

  private static repair(input: Buffer): Buffer {
    const parsed = readFitMessages(input, {
      messageNumbers: [0, 12, 18, 19, 21, 34], maxInputBytes: MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES,
    });
    const messages = (global: number) => parsed.messages.filter(m => m.globalMessageNumber === global);
    const value = (m: FitRawMessage, n: number, type = 6, size: 1 | 2 | 4 = 4) =>
      readFitUnsignedField(m.fields.find(f => f.fieldNumber === n), type, size, m.littleEndian);
    const requireValue = (m: FitRawMessage, n: number, type = 6, size: 1 | 2 | 4 = 4): number => {
      const result = value(m, n, type, size);
      if (result === undefined) throw new Error('Missing FIT summary evidence.');
      return result;
    };
    const require = (condition: boolean) => { if (!condition) throw new Error('Ambiguous FIT summary evidence.'); };
    const files = messages(0), laps = messages(19), activities = messages(34);
    require(parsed.issues.length === 0 && files.length === 1 && value(files[0], 0, 0, 1) === 4
      && messages(18).length === 0 && activities.length === 1 && laps.length > 0 && laps.length < 65535);
    const activity = activities[0];
    const declaredCount = requireValue(activity, 1, 4, 2);
    require(value(activity, 2, 0, 1) === 0 && (declaredCount === 1 || declaredCount === laps.length));
    const sport = requireValue(laps[0], 25, 0, 1);
    require(getFitSportName(sport) !== null && ![0, 17, 254].includes(sport));
    const subSport = value(laps[0], 39, 0, 1);
    for (const m of messages(12)) {
      require(value(m, 0, 0, 1) === sport && value(m, 1, 0, 1) === subSport);
    }
    const timers = messages(21).filter(m => value(m, 0, 0, 1) === 0);
    require(timers.length === 2 && value(timers[0], 1, 0, 1) === 0
      && [1, 4, 8, 9].includes(requireValue(timers[1], 1, 0, 1)));
    const start = requireValue(laps[0], 2), end = requireValue(laps[laps.length - 1], 253);
    require(start === requireValue(timers[0], 253) && end === requireValue(timers[1], 253)
      && end === requireValue(activity, 253));
    let previousEnd = start, elapsed = 0, timer = 0, distance = 0;
    const indexed = laps[0].fields.some(f => f.fieldNumber === 254);
    for (const [index, lap] of laps.entries()) {
      const lapStart = requireValue(lap, 2), lapEnd = requireValue(lap, 253);
      const lapElapsed = requireValue(lap, 7), lapTimer = requireValue(lap, 8);
      require(lapStart === previousEnd && lapEnd > lapStart && lapElapsed > 0
        && Math.abs(lapElapsed - (lapEnd - lapStart) * 1000) < 1000
        && lapTimer > 0 && lapTimer <= lapElapsed
        && value(lap, 25, 0, 1) === sport && value(lap, 39, 0, 1) === subSport);
      require(indexed ? value(lap, 254, 4, 2) === index : !lap.fields.some(f => f.fieldNumber === 254));
      previousEnd = lapEnd;
      elapsed += lapElapsed; timer += lapTimer; distance += requireValue(lap, 9);
    }
    require([elapsed, timer, distance].every(n => Number.isSafeInteger(n) && n < 0xffffffff));
    require(Math.abs(elapsed - (end - start) * 1000) < 1000);
    const activityTimer = value(activity, 0);
    require(activityTimer === undefined || activityTimer === timer);
    const field = (number: number, size: number, baseType: T, v: number): FitEncoderField =>
      ({ number, size, baseType, value: v });
    const fields = [field(254, 2, T.Uint16, 0), field(253, 4, T.Uint32, end),
      field(0, 1, T.Enum, 8), field(1, 1, T.Enum, 1), field(2, 4, T.Uint32, start),
      field(5, 1, T.Enum, sport), field(7, 4, T.Uint32, elapsed), field(8, 4, T.Uint32, timer),
      field(9, 4, T.Uint32, distance), field(25, 2, T.Uint16, 0), field(26, 2, T.Uint16, laps.length)];
    if (subSport !== undefined) fields.push(field(6, 1, T.Enum, subSport));
    const calories = laps.map(lap => value(lap, 11, 4, 2));
    if (calories.every(n => n !== undefined)) {
      const total = (calories as number[]).reduce((sum, n) => sum + n, 0);
      if (total < 65535) fields.push(field(11, 2, T.Uint16, total));
    }
    const footer = this.locateFooter(input, start, end);
    const encoded = new FitEncoder({ protocolVersion: parsed.protocolVersion, profileVersion: parsed.profileVersion })
      .writeMessage(18, fields, footer.local).close();
    const sessionBytes = encoded.subarray(encoded[0], encoded.length - 2);
    // Restore the footer's local definition after the encoder reuses its slot.
    const footerDefinition = input.subarray(footer.definitionStart, footer.definitionEnd);
    const outputSize = input.length + sessionBytes.length + footerDefinition.length;
    require(outputSize <= MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES);
    const output = Buffer.allocUnsafe(outputSize);
    let cursor = input.copy(output, 0, 0, footer.recordStart);
    output.set(sessionBytes, cursor); cursor += sessionBytes.length;
    footerDefinition.copy(output, cursor); cursor += footerDefinition.length;
    input.copy(output, cursor, footer.recordStart);
    const countOffset = cursor + footer.countOffset - footer.recordStart;
    if (footer.littleEndian) output.writeUInt16LE(1, countOffset); else output.writeUInt16BE(1, countOffset);
    output.writeUInt32LE(output.length - output[0] - 2, 4);
    if (output[0] === 14) output.writeUInt16LE(FitEncoder.calculateCRC(output.subarray(0, 12)), 12);
    output.writeUInt16LE(FitEncoder.calculateCRC(output.subarray(0, -2)), output.length - 2);
    const verified = readFitMessages(output, { messageNumbers: [18, 34], maxInputBytes: MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES });
    require(verified.issues.length === 0 && verified.messages.filter(m => m.globalMessageNumber === 18).length === 1);
    return output;
  }

  /** Walk only a strictly validated envelope; keep binary span work in this class. */
  private static locateFooter(input: Buffer, start: number, end: number) {
    const definitions = new Map<number, { global: number; littleEndian: boolean; fields: Array<{ number: number; size: number }>;
      developerSize: number; start: number; end: number }>();
    const dataEnd = input[0] + input.readUInt32LE(4);
    let cursor = input[0], recordCount = 0, dataCount = 0;
    let lastTimestamp: number | undefined, lastRecordTimestamp = start;
    while (cursor < dataEnd) {
      const recordStart = cursor, header = input[cursor++], compressed = (header & 0x80) !== 0;
      const local = compressed ? (header >> 5) & 3 : header & 15;
      if (!compressed && (header & 0x40) !== 0) {
        const littleEndian = input[cursor + 1] === 0;
        const global = littleEndian ? input.readUInt16LE(cursor + 2) : input.readUInt16BE(cursor + 2);
        const count = input[cursor + 4], fields: Array<{ number: number; size: number }> = [];
        cursor += 5;
        for (let i = 0; i < count; i++, cursor += 3) fields.push({ number: input[cursor], size: input[cursor + 1] });
        let developerSize = 0;
        if ((header & 0x20) !== 0) {
          const developerCount = input[cursor++];
          for (let i = 0; i < developerCount; i++, cursor += 3) developerSize += input[cursor + 1];
        }
        definitions.set(local, { global, littleEndian, fields, developerSize, start: recordStart, end: cursor });
        continue;
      }
      const definition = definitions.get(local)!;
      if (dataCount++ === 0 && definition.global !== 0) throw new Error('FIT File ID is not first.');
      let timestamp: number | undefined;
      if (compressed) {
        // The strict fit-parser reader already proved the compressed header's
        // baseline and timestamp field shape. Only track time; never re-encode it.
        timestamp = Math.floor(lastTimestamp! / 32) * 32 + (header & 31);
        if (timestamp < lastTimestamp!) timestamp += 32;
        lastTimestamp = timestamp;
      }
      let countOffset = -1;
      for (const f of definition.fields) {
        if (compressed && f.number === 253) continue;
        if (f.number === 253) {
          timestamp = definition.littleEndian ? input.readUInt32LE(cursor) : input.readUInt32BE(cursor);
          lastTimestamp = timestamp;
        }
        if (f.number === 1) countOffset = cursor;
        cursor += f.size;
      }
      cursor += definition.developerSize;
      if (definition.global === 20) {
        if (timestamp === undefined || timestamp < lastRecordTimestamp || timestamp > end) {
          throw new Error('FIT samples are outside the evidenced Session.');
        }
        lastRecordTimestamp = timestamp;
        recordCount++;
      }
      if (definition.global === 34) {
        if (compressed || cursor !== dataEnd || countOffset < 0 || recordCount === 0) throw new Error('FIT footer is not final.');
        return { local, recordStart, countOffset, littleEndian: definition.littleEndian,
          definitionStart: definition.start, definitionEnd: definition.end };
      }
    }
    throw new Error('Missing FIT footer.');
  }
}
