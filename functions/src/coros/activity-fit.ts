import { FitEncoder } from 'fit-file-parser/encoder';
import { FitMessageReaderError, getFitBaseTypeId, readFitMessages, readFitUnsignedField } from 'fit-file-parser/raw';
import * as logger from 'firebase-functions/logger';
import { MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES } from '../shared/activity-processing-config';

// Fixed mappings verified through controlled COROS imports and owner app checks (#600).
const SNORKELING = 82;
const SAILING = 32;
const SWIMMING = 5;
const OPEN_WATER = 18; // FIT sub_sport; 17 is lap_swimming, not open water.
const MAX_BYTES = MAX_ACTIVITY_CALLABLE_UPLOAD_BYTES;
const CATEGORY_FIELDS = new Map([
  [12, { sport: 0, subSport: 1 }],
  [18, { sport: 5, subSport: 6 }],
  [19, { sport: 25, subSport: 39 }], // Lap field 26 is event_group.
]);

interface FieldDefinition { number: number; size: number; baseType: number }
interface Definition {
  global: number;
  littleEndian: boolean;
  fields: FieldDefinition[];
  developerSize: number;
  additions: Array<{ number: number; value: number }>;
  category: { sport: number; subSport: number } | undefined;
  offset: number;
  patched: boolean;
}
interface Patch { offset: number; remove: number; bytes: Buffer }

/**
 * Build a separate Open Water Swim FIT copy for an explicitly selected,
 * single-session snorkeling activity. Does not upload, persist, or mutate input.
 * Refuse other/mixed sports and malformed files instead of guessing a category.
 */
export function createCOROSSnorkelingFIT(input: Buffer, requireGPS = false): Buffer {
  return createCategoryCopy(input, SNORKELING, SWIMMING, OPEN_WATER, 'snorkeling', requireGPS);
}

/** Generic/generic FIT imports as GPS Cardio in the verified outdoor sailing case. */
export function createCOROSSailingFIT(input: Buffer, requireGPS = false): Buffer {
  return createCategoryCopy(input, SAILING, 0, 0, 'sailing', requireGPS);
}

/**
 * Repair only the reproduced empty native definitions, then adapt the two
 * verified mappings. Snorkeling needs no GPS; sailing retains its GPS requirement.
 * No original is mutated or retained. Fingerprint and send the returned buffer.
 */
export function prepareCOROSActivityFITUpload(input: Buffer): Buffer {
  let prepared = input;
  let output: Buffer;
  let sourceSport: number | undefined;
  try {
    let parsed;
    try {
      parsed = readFitMessages(input, { messageNumbers: [18], maxInputBytes: MAX_BYTES });
    } catch (error) {
      // The strict reader checks the original header, length and CRCs before
      // walking definitions. Never repair a corrupt or oversized source file.
      if (!(error instanceof FitMessageReaderError) || error.code !== 'invalid_structure') return input;
      const repaired = removeCOROSEmptyFieldDefinitions(input);
      prepared = repaired.output;
      logger.info('[COROS] Removed empty activity FIT field definitions.', {
        removedFieldDefinitions: repaired.removedFieldDefinitions,
      });
      parsed = readFitMessages(prepared, { messageNumbers: [18], maxInputBytes: MAX_BYTES });
    }
    if (parsed.messages.length !== 1) return prepared;
    const session = parsed.messages[0];
    sourceSport = readFitUnsignedField(session.fields.find(field => field.fieldNumber === 5), 0, 1, session.littleEndian);
    if (sourceSport === SNORKELING) output = createCOROSSnorkelingFIT(prepared);
    else if (sourceSport === SAILING) output = createCOROSSailingFIT(prepared, true);
    else return prepared;
  } catch {
    // A fallback must not reject files the existing upload path might accept.
    return prepared;
  }
  logger.info('[COROS] Applied activity FIT category fallback.', {
    mapping: sourceSport === SNORKELING ? 'snorkeling_to_open_water_swim' : 'sailing_to_gps_cardio',
  });
  return output;
}

/** Remove definition triplets with no data bytes, not actual sensor values. */
function removeCOROSEmptyFieldDefinitions(input: Buffer): { output: Buffer; removedFieldDefinitions: number } {
  const dataEnd = input[0] + input.readUInt32LE(4);
  const definitions = new Map<number, Pick<Definition, 'global' | 'fields' | 'developerSize'>>();
  const widths = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8];
  let cursor = input[0], copiedUntil = 0, outputCursor = 0, removedFieldDefinitions = 0;
  let output: Buffer | undefined;
  let fileCount = 0, sessionCount = 0;
  const reject = () => { throw new Error('FIT is outside the verified COROS empty-field repair.'); };
  const take = (size: number) => {
    if (cursor + size > dataEnd) reject();
    const offset = cursor;
    cursor += size;
    return offset;
  };
  while (cursor < dataEnd) {
    const header = input[take(1)], compressed = (header & 0x80) !== 0;
    const local = compressed ? (header >> 5) & 3 : header & 15;
    if (!compressed && (header & 0x10) !== 0) reject();
    if (!compressed && (header & 0x40) !== 0) {
      const offset = take(5);
      if (input[offset] !== 0 || input[offset + 1] > 1) reject();
      const global = input[offset + 1] === 0 ? input.readUInt16LE(offset + 2) : input.readUInt16BE(offset + 2);
      const count = input[offset + 4], fields: FieldDefinition[] = [], numbers = new Set<number>();
      for (let index = 0; index < count; index++) {
        const fieldOffset = take(3);
        const field = { number: input[fieldOffset], size: input[fieldOffset + 1], baseType: input[fieldOffset + 2] };
        if (numbers.has(field.number)) reject();
        numbers.add(field.number);
        fields.push(field);
        if (field.size === 0) {
          if (field.baseType !== 0x86 || !((global === 21 && field.number === 3)
            || (global === 19 && field.number === 10))) reject();
          // At most one matching field per definition. Allocate once and stream
          // the unchanged spans, bounding memory even for many redefinitions.
          output ??= Buffer.allocUnsafe(input.length);
          outputCursor += input.copy(output, outputCursor, copiedUntil, fieldOffset);
          output[outputCursor - (fieldOffset - offset - 4)] = count - 1;
          copiedUntil = fieldOffset + 3;
          removedFieldDefinitions++;
        } else {
          const type = getFitBaseTypeId(field.baseType);
          if (type === null || field.size % widths[type] !== 0
            || (field.number === 253 && (field.size !== 4 || type !== 6))) reject();
        }
      }
      let developerSize = 0;
      if ((header & 0x20) !== 0) {
        const developerCount = input[take(1)], keys = new Set<number>();
        for (let index = 0; index < developerCount; index++) {
          const fieldOffset = take(3), size = input[fieldOffset + 1];
          const key = input[fieldOffset + 2] * 256 + input[fieldOffset];
          if (size === 0 || keys.has(key)) reject();
          keys.add(key);
          developerSize += size;
        }
      }
      definitions.set(local, { global, fields, developerSize });
      continue;
    }
    if (!compressed && (header & 0x20) !== 0) reject();
    const definition = definitions.get(local);
    if (!definition) return reject();
    if (definition.global === 0 && ++fileCount > 1) reject();
    if (definition.global === 18 && ++sessionCount > 1) reject();
    for (const field of definition.fields) {
      if (!(compressed && field.number === 253)) take(field.size);
    }
    take(definition.developerSize);
  }
  if (!output || fileCount !== 1 || sessionCount !== 1) return reject();
  outputCursor += input.copy(output, outputCursor, copiedUntil, dataEnd);
  output = output.subarray(0, outputCursor + 2);
  output.writeUInt32LE(output.length - input[0] - 2, 4);
  if (input[0] === 14) output.writeUInt16LE(FitEncoder.calculateCRC(output.subarray(0, 12)), 12);
  output.writeUInt16LE(FitEncoder.calculateCRC(output.subarray(0, -2)), output.length - 2);
  const parsed = readFitMessages(output, { messageNumbers: [0, 18], maxInputBytes: MAX_BYTES });
  const fileId = parsed.messages.find(message => message.globalMessageNumber === 0)!;
  if (parsed.issues.length || readFitUnsignedField(fileId.fields.find(field => field.fieldNumber === 0),
    0, 1, fileId.littleEndian) !== 4) reject();
  return { output, removedFieldDefinitions };
}

function createCategoryCopy(input: Buffer, sourceSport: number, targetSport: number,
  targetSubSport: number, sourceName: string, requireGPS: boolean): Buffer {
  const parsed = readFitMessages(input, { messageNumbers: [0, 12, 18, 19], maxInputBytes: MAX_BYTES });
  const value = (message: typeof parsed.messages[number], number: number) => readFitUnsignedField(
    message.fields.find(field => field.fieldNumber === number), 0, 1, message.littleEndian,
  );
  const fileIds = parsed.messages.filter(message => message.globalMessageNumber === 0);
  const sessions = parsed.messages.filter(message => message.globalMessageNumber === 18);
  if (parsed.issues.length || fileIds.length !== 1 || value(fileIds[0], 0) !== 4
    || sessions.length !== 1 || value(sessions[0], 5) !== sourceSport) {
    throw new Error(`Conversion requires a valid single-session ${sourceName} activity FIT.`);
  }
  for (const message of parsed.messages) {
    const category = CATEGORY_FIELDS.get(message.globalMessageNumber);
    if (!category) continue;
    const sport = value(message, category.sport);
    if (sport !== undefined && sport !== sourceSport) {
      throw new Error('Conversion refuses conflicting FIT sport classifications.');
    }
    // Validate the scalar shape even though the selected fallback replaces it.
    value(message, category.subSport);
  }

  // Walk the already validated record envelope, patching only category bytes
  // and missing category definitions/data. This retains opaque/vendor fields,
  // developer data, endianness, record order and compressed timestamp headers.
  // Semantic decode/re-export would not provide those preservation guarantees.
  const definitions = new Map<number, Definition>();
  const patches: Patch[] = [];
  const replace = (offset: number, byte: number) => {
    if (input[offset] !== byte) patches.push({ offset, remove: 1, bytes: Buffer.from([byte]) });
  };
  const dataEnd = input[0] + input.readUInt32LE(4);
  let hasGPS = false;
  let cursor = input[0];
  while (cursor < dataEnd) {
    const start = cursor;
    const header = input[cursor++];
    const compressed = (header & 0x80) !== 0;
    const local = compressed ? (header >> 5) & 3 : header & 15;
    if (!compressed && (header & 0x40) !== 0) {
      const littleEndian = input[cursor + 1] === 0;
      const global = littleEndian ? input.readUInt16LE(cursor + 2) : input.readUInt16BE(cursor + 2);
      const count = input[cursor + 4];
      cursor += 5;
      const fields: FieldDefinition[] = [];
      for (let index = 0; index < count; index++, cursor += 3) {
        fields.push({ number: input[cursor], size: input[cursor + 1], baseType: input[cursor + 2] });
      }
      let developerSize = 0;
      if ((header & 0x20) !== 0) {
        const developerCount = input[cursor++];
        for (let index = 0; index < developerCount; index++, cursor += 3) developerSize += input[cursor + 1];
      }
      const category = CATEGORY_FIELDS.get(global);
      const additions = category ? [
        { number: category.sport, value: targetSport },
        { number: category.subSport, value: targetSubSport },
      ].filter(field => !fields.some(existing => existing.number === field.number)) : [];
      definitions.set(local, { global, littleEndian, fields, developerSize, category, additions, offset: start, patched: false });
      continue;
    }
    const definition = definitions.get(local)!; // Strict reader proved definition/record bounds.
    if (definition.category && !definition.patched) {
      if (definition.fields.length + definition.additions.length > 255) {
        throw new Error('Conversion cannot extend a full FIT field definition.');
      }
      if (definition.additions.length) {
        replace(definition.offset + 5, definition.fields.length + definition.additions.length);
        patches.push({ offset: definition.offset + 6 + definition.fields.length * 3, remove: 0,
          bytes: Buffer.from(definition.additions.flatMap(field => [field.number, 1, 0])) });
      }
      definition.patched = true;
    }
    let latitude: number | undefined;
    let longitude: number | undefined;
    for (const field of definition.fields) {
      if (compressed && field.number === 253) continue;
      if (definition.category) {
        if (field.number === definition.category.sport) replace(cursor, targetSport);
        if (field.number === definition.category.subSport) replace(cursor, targetSubSport);
      }
      if (definition.global === 20 && (field.number === 0 || field.number === 1)
        && field.size === 4 && field.baseType === 0x85) {
        const coordinate = definition.littleEndian ? input.readInt32LE(cursor) : input.readInt32BE(cursor);
        if (coordinate !== 0x7fffffff) {
          if (field.number === 0) latitude = coordinate;
          else longitude = coordinate;
        }
      }
      cursor += field.size;
    }
    if (latitude !== undefined && longitude !== undefined && Math.abs(latitude) <= 0x40000000) hasGPS = true;
    if (definition.additions.length) patches.push({ offset: cursor, remove: 0,
      bytes: Buffer.from(definition.additions.map(field => field.value)) });
    cursor += definition.developerSize;
  }

  if (requireGPS && !hasGPS) throw new Error('Outdoor category conversion requires recorded GPS coordinates.');

  patches.sort((left, right) => left.offset - right.offset);
  const parts: Buffer[] = [];
  cursor = 0;
  for (const patch of patches) {
    parts.push(input.subarray(cursor, patch.offset), patch.bytes);
    cursor = patch.offset + patch.remove;
  }
  parts.push(input.subarray(cursor, dataEnd));
  const outputSize = input.length + patches.reduce((growth, patch) => growth + patch.bytes.length - patch.remove, 0);
  if (outputSize > MAX_BYTES) throw new Error('Converted copy exceeds the FIT size bound.');
  const output = Buffer.concat([...parts, Buffer.alloc(2)]);
  output.writeUInt32LE(output.length - input[0] - 2, 4);
  if (input[0] === 14) output.writeUInt16LE(FitEncoder.calculateCRC(output.subarray(0, 12)), 12);
  output.writeUInt16LE(FitEncoder.calculateCRC(output.subarray(0, -2)), output.length - 2);
  readFitMessages(output, { messageNumbers: [0, 12, 18, 19], maxInputBytes: MAX_BYTES });
  return output;
}
