const COROS_INT64_JSON_FIELDS = ['uploadId', 'labelId', 'planWorkoutId'] as const;
const COROS_INT64_JSON_FIELD_SET = new Set<string>(COROS_INT64_JSON_FIELDS);
const COROS_UNQUOTED_INT64_PATTERN = /^-?\d{16,20}/;

function findJSONStringEnd(raw: string, start: number): number | null {
  let escaped = false;
  for (let index = start + 1; index < raw.length; index++) {
    if (escaped) {
      escaped = false;
    } else if (raw[index] === '\\') {
      escaped = true;
    } else if (raw[index] === '"') {
      return index + 1;
    }
  }
  return null;
}

function skipJSONWhitespace(raw: string, start: number): number {
  let index = start;
  while (index < raw.length && /\s/.test(raw[index])) index++;
  return index;
}

/** Protects provider IDs from JavaScript number precision loss before JSON.parse. */
export function protectCOROSInt64Identifiers(raw: string): string {
  let output = '';
  let cursor = 0;
  while (cursor < raw.length) {
    if (raw[cursor] !== '"') {
      output += raw[cursor];
      cursor++;
      continue;
    }

    const stringEnd = findJSONStringEnd(raw, cursor);
    if (stringEnd === null) {
      output += raw.slice(cursor);
      break;
    }
    const stringToken = raw.slice(cursor, stringEnd);
    output += stringToken;
    cursor = stringEnd;

    let fieldName: unknown;
    try {
      fieldName = JSON.parse(stringToken);
    } catch {
      continue;
    }
    if (typeof fieldName !== 'string' || !COROS_INT64_JSON_FIELD_SET.has(fieldName)) continue;

    const colonIndex = skipJSONWhitespace(raw, cursor);
    if (raw[colonIndex] !== ':') continue;
    const valueStart = skipJSONWhitespace(raw, colonIndex + 1);
    const numberMatch = COROS_UNQUOTED_INT64_PATTERN.exec(raw.slice(valueStart));
    if (!numberMatch) continue;
    const numberEnd = valueStart + numberMatch[0].length;
    const delimiterIndex = skipJSONWhitespace(raw, numberEnd);
    if (!',}]'.includes(raw[delimiterIndex] || '')) continue;

    output += `${raw.slice(cursor, valueStart)}"${numberMatch[0]}"`;
    cursor = numberEnd;
  }
  return output;
}

export function parseCOROSJSON<T>(raw: string | Buffer): T {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  return JSON.parse(protectCOROSInt64Identifiers(text)) as T;
}
