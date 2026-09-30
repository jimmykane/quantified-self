import { createHash, randomUUID } from 'node:crypto';
import { SPORTS_LIB_VERSION } from './sports-lib-version.node';

// Parser exceptions can embed file content. Only known literal messages may
// leave this boundary; redacting URLs alone cannot remove names or coordinates.
const SAFE_PARSER_MESSAGES = new Set([
  'No activities found',
  'Cannot parse start and end dates',
  'Trying to get samples from activities lengths, but no lengths is available',
  'File to small to be a FIT file',
  'Incorrect header size',
  "Missing '.FIT' in header",
  'Header CRC mismatch',
  'File data exceeds input length',
  'File CRC missing',
  'File CRC mismatch',
]);
const SAFE_ERROR_NAMES = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'EmptyEventLibError', 'ParsingEventLibError', 'DurationExceededEventLibError',
]);
const SAFE_ERROR_CODES = new Set(['EVENT_EMPTY_ERROR', 'PARSING_LIB_ERROR', 'ERR_BUFFER_OUT_OF_BOUNDS', 'ERR_OUT_OF_RANGE']);
const SAFE_FORMATS = new Set(['fit', 'gpx', 'tcx', 'json', 'sml']);
const SAFE_PARSER_MODULES = new Set([
  'lib/cjs/events/adapters/importers/json/importer.json.js',
  'lib/cjs/events/adapters/importers/suunto/importer.suunto.json.js',
  'lib/cjs/events/adapters/importers/suunto/importer.suunto.sml.js',
]);
const MAX_JSON_SHAPE_BYTES = 64 * 1024;

function getJsonShape(payload: Buffer) {
  if (payload.length > MAX_JSON_SHAPE_BYTES) {
    return { rootType: 'not_inspected_large' };
  }
  try {
    const parsed: unknown = JSON.parse(payload.toString('utf8'));
    const rootType = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    const record = rootType === 'object' ? parsed as Record<string, unknown> : null;
    return {
      rootType,
      hasDeviceLog: record !== null && Object.prototype.hasOwnProperty.call(record, 'DeviceLog'),
      samplesShape: record !== null && Object.prototype.hasOwnProperty.call(record, 'Samples')
        ? Array.isArray(record.Samples) ? 'array' : 'other'
        : 'missing',
    };
  } catch {
    return { rootType: 'invalid' };
  }
}

export function getActivityParserDiagnostics(error: unknown, payload: Buffer, extension: string) {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const message = (typeof record.message === 'string' ? record.message : typeof error === 'string' ? error : '').slice(0, 4096);
  const name = typeof record.name === 'string' ? record.name : '';
  const code = typeof record.code === 'string' ? record.code : '';
  const baseExtension = extension.replace(/\.gz$/, '');
  const isFit = baseExtension === 'fit';
  const hasFitSignature = isFit && payload.length >= 12 && payload.subarray(8, 12).equals(Buffer.from('.FIT'));
  // Keep only the package, an allowlisted package-relative module, and line/column.
  // Never log the raw stack, function names, absolute paths, or source text.
  const parserSite = typeof record.stack === 'string'
    ? record.stack.slice(0, 8192).match(/node_modules\/(?:@sports-alliance\/(sports-lib)|(fit-file-parser))\/([^\s():]+):(\d{1,7}):(\d{1,7})/)
    : null;

  return {
    diagnosticId: randomUUID(),
    sportsLibVersion: SPORTS_LIB_VERSION,
    format: SAFE_FORMATS.has(baseExtension) ? baseExtension : 'unknown',
    payloadBytes: payload.length,
    errorName: SAFE_ERROR_NAMES.has(name) ? name : 'UnknownError',
    errorCode: SAFE_ERROR_CODES.has(code) ? code : null,
    errorMessage: SAFE_PARSER_MESSAGES.has(message) ? message : 'Unclassified parser error; message withheld.',
    errorMessageFingerprint: message ? createHash('sha256').update(message).digest('hex') : null,
    parserSite: parserSite ? {
      package: parserSite[1] || parserSite[2],
      module: parserSite[1] && SAFE_PARSER_MODULES.has(parserSite[3]) ? parserSite[3] : null,
      line: Number(parserSite[4]),
      column: Number(parserSite[5]),
    } : null,
    ...(baseExtension === 'json' ? { jsonShape: getJsonShape(payload) } : {}),
    ...(isFit ? {
      fitSignaturePresent: hasFitSignature,
      fitDeclaredDataBytes: hasFitSignature ? payload.readUInt32LE(4) : null,
    } : {}),
  };
}
