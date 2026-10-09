import { FitEncoder } from 'fit-file-parser/encoder';
import { readFitMessages, readFitUnsignedField } from 'fit-file-parser/raw';

// Local #600 proof only. Deliberately not imported by any upload/queue path:
// valid FIT encoding does not establish COROS partner-API acceptance.
const SNORKELING = 82;
const SAILING = 32;
const SWIMMING = 5;
const OPEN_WATER = 18; // FIT sub_sport; 17 is lap_swimming, not open water.
const MAX_BYTES = 30 * 1024 * 1024;
const CATEGORY_FIELDS = new Map([
  [12, { sport: 0, subSport: 1 }],
  [18, { sport: 5, subSport: 6 }],
  [19, { sport: 25, subSport: 39 }], // Lap field 26 is event_group.
]);

interface FieldDefinition { number: number; size: number; baseType: number }
interface Definition {
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
export function createCOROSSnorkelingFITProof(input: Buffer): Buffer {
  return createCategoryProof(input, SNORKELING, SWIMMING, OPEN_WATER, 'snorkeling');
}

/** Experimental generic/generic copy; COROS GPS Cardio acceptance is NOT established. */
export function createCOROSSailingGenericFITProof(input: Buffer): Buffer {
  return createCategoryProof(input, SAILING, 0, 0, 'sailing');
}

function createCategoryProof(input: Buffer, sourceSport: number, targetSport: number,
  targetSubSport: number, sourceName: string): Buffer {
  const parsed = readFitMessages(input, { messageNumbers: [0, 12, 18, 19], maxInputBytes: MAX_BYTES });
  const value = (message: typeof parsed.messages[number], number: number) => readFitUnsignedField(
    message.fields.find(field => field.fieldNumber === number), 0, 1, message.littleEndian,
  );
  const fileIds = parsed.messages.filter(message => message.globalMessageNumber === 0);
  const sessions = parsed.messages.filter(message => message.globalMessageNumber === 18);
  if (parsed.issues.length || fileIds.length !== 1 || value(fileIds[0], 0) !== 4
    || sessions.length !== 1 || value(sessions[0], 5) !== sourceSport) {
    throw new Error(`Proof requires a valid single-session ${sourceName} activity FIT.`);
  }
  for (const message of parsed.messages) {
    const category = CATEGORY_FIELDS.get(message.globalMessageNumber);
    if (!category) continue;
    const sport = value(message, category.sport);
    if (sport !== undefined && sport !== sourceSport) {
      throw new Error('Proof refuses conflicting FIT sport classifications.');
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
      definitions.set(local, { fields, developerSize, category, additions, offset: start, patched: false });
      continue;
    }
    const definition = definitions.get(local)!; // Strict reader proved definition/record bounds.
    if (definition.category && !definition.patched) {
      if (definition.fields.length + definition.additions.length > 255) {
        throw new Error('Proof cannot extend a full FIT field definition.');
      }
      if (definition.additions.length) {
        replace(definition.offset + 5, definition.fields.length + definition.additions.length);
        patches.push({ offset: definition.offset + 6 + definition.fields.length * 3, remove: 0,
          bytes: Buffer.from(definition.additions.flatMap(field => [field.number, 1, 0])) });
      }
      definition.patched = true;
    }
    for (const field of definition.fields) {
      if (compressed && field.number === 253) continue;
      if (definition.category) {
        if (field.number === definition.category.sport) replace(cursor, targetSport);
        if (field.number === definition.category.subSport) replace(cursor, targetSubSport);
      }
      cursor += field.size;
    }
    if (definition.additions.length) patches.push({ offset: cursor, remove: 0,
      bytes: Buffer.from(definition.additions.map(field => field.value)) });
    cursor += definition.developerSize;
  }

  patches.sort((left, right) => left.offset - right.offset);
  const parts: Buffer[] = [];
  cursor = 0;
  for (const patch of patches) {
    parts.push(input.subarray(cursor, patch.offset), patch.bytes);
    cursor = patch.offset + patch.remove;
  }
  parts.push(input.subarray(cursor, dataEnd));
  const outputSize = input.length + patches.reduce((growth, patch) => growth + patch.bytes.length - patch.remove, 0);
  if (outputSize > MAX_BYTES) throw new Error('Converted proof exceeds the FIT size bound.');
  const output = Buffer.concat([...parts, Buffer.alloc(2)]);
  output.writeUInt32LE(output.length - input[0] - 2, 4);
  if (input[0] === 14) output.writeUInt16LE(FitEncoder.calculateCRC(output.subarray(0, 12)), 12);
  output.writeUInt16LE(FitEncoder.calculateCRC(output.subarray(0, -2)), output.length - 2);
  readFitMessages(output, { messageNumbers: [0, 12, 18, 19], maxInputBytes: MAX_BYTES });
  return output;
}
