import { describe, expect, it, vi } from 'vitest';
import { getActivityParserDiagnostics } from './activity-parser-diagnostics';
import { SPORTS_LIB_VERSION } from './sports-lib-version.node';

function makeJsonParserError(message: string, importer: 'json' | 'sml') {
  const error = new TypeError(message);
  error.stack = `TypeError: ${message}\n at parse (/private/node_modules/@sports-alliance/sports-lib/lib/cjs/events/adapters/importers/suunto/importer.suunto.${importer}.js:81:36)`;
  return error;
}

describe('activity parser diagnostics', () => {
  it('reports a known parser reason, installed version and structural FIT facts', () => {
    const payload = Buffer.alloc(12);
    payload.writeUInt32LE(123, 4);
    payload.write('.FIT', 8);
    const result = getActivityParserDiagnostics(Object.assign(new Error('No activities found'), {
      name: 'EmptyEventLibError', code: 'EVENT_EMPTY_ERROR',
    }), payload, 'fit');
    expect(result).toMatchObject({
      sportsLibVersion: SPORTS_LIB_VERSION, payloadBytes: 12, format: 'fit',
      errorName: 'EmptyEventLibError', errorCode: 'EVENT_EMPTY_ERROR', errorMessage: 'No activities found',
      fitSignaturePresent: true, fitDeclaredDataBytes: 123,
    });
    expect(result.diagnosticId).toMatch(/^[a-f\d-]{36}$/);
  });

  it('never exposes arbitrary error fields, raw payload, URLs, coordinates, names or stack paths', () => {
    const sensitive = 'Alice 37.1234 -122.5678 https://storage.example/file?sig=secret Bearer token';
    const error = { name: sensitive, code: sensitive, message: sensitive, cause: sensitive,
      stack: `Error: ${sensitive}\n at privateName (/private/user/node_modules/@sports-alliance/sports-lib/lib/cjs/private-name.js:242:12)` };
    const result = getActivityParserDiagnostics(error, Buffer.from(sensitive), 'gpx.gz');
    expect(result).toMatchObject({
      format: 'gpx', errorName: 'UnknownError', errorCode: null,
      errorMessage: 'Unclassified parser error; message withheld.',
      parserSite: { package: 'sports-lib', module: null, line: 242, column: 12 },
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of ['Alice', '37.1234', '-122.5678', 'https:', 'secret', 'Bearer', 'privateName', '/private', 'private-name']) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(result).not.toHaveProperty('fitSignaturePresent');
  });

  it.each([null, undefined, 42, {}, 'File CRC mismatch'])('handles non-Error parser failures safely: %j', error => {
    const result = getActivityParserDiagnostics(error, Buffer.alloc(0), 'fit');
    expect(result).toMatchObject({ payloadBytes: 0, fitSignaturePresent: false, fitDeclaredDataBytes: null });
  });

  it('groups unknown messages without logging them', () => {
    const first = getActivityParserDiagnostics(new Error('private parser data'), Buffer.alloc(0), 'fit');
    const second = getActivityParserDiagnostics(new Error('private parser data'), Buffer.alloc(0), 'fit');
    expect(first.errorMessageFingerprint).toBe(second.errorMessageFingerprint);
    expect(first.diagnosticId).not.toBe(second.diagnosticId);
  });

  it('logs only allowlisted importer and fixed JSON shape facts', () => {
    const sensitive = 'Alice private workout';
    const error = new TypeError(`Cannot parse ${sensitive}`);
    error.stack = `TypeError: ${sensitive}\n at parse (/private/node_modules/@sports-alliance/sports-lib/lib/cjs/events/adapters/importers/suunto/importer.suunto.sml.js:81:36)`;
    const result = getActivityParserDiagnostics(error,
      Buffer.from(JSON.stringify({ DeviceLog: { name: sensitive }, Samples: {} })), 'json');

    expect(result).toMatchObject({
      errorName: 'TypeError',
      errorMessage: 'Unclassified parser error; message withheld.',
      parserSite: {
        package: 'sports-lib',
        module: 'lib/cjs/events/adapters/importers/suunto/importer.suunto.sml.js',
        line: 81,
        column: 36,
      },
      jsonShape: { rootType: 'object', hasDeviceLog: true, samplesShape: 'other' },
    });
    expect(JSON.stringify(result)).not.toContain(sensitive);
    expect(JSON.stringify(result)).not.toContain('/private');
  });

  it('bounds JSON inspection and identifies missing or invalid sample structure', () => {
    expect(getActivityParserDiagnostics(new Error('failure'), Buffer.from('{"Samples":[]}'), 'json'))
      .toMatchObject({ jsonShape: { rootType: 'object', hasDeviceLog: false, samplesShape: 'array' } });
    expect(getActivityParserDiagnostics(new Error('failure'), Buffer.from('{'), 'json'))
      .toMatchObject({ jsonShape: { rootType: 'invalid' } });
    expect(getActivityParserDiagnostics(new Error('failure'), Buffer.alloc((64 * 1024) + 1), 'json'))
      .toMatchObject({ jsonShape: { rootType: 'not_inspected_large' } });
  });

  it.each([
    ["Cannot read properties of undefined (reading 'filter')", 'missing_top_level_samples'],
    ["Cannot read properties of null (reading 'filter')", 'null_top_level_samples'],
    ['json.Samples.filter is not a function', 'non_array_top_level_samples'],
  ])('reports both attempts and a fixed structural reason: %s', (message, reason) => {
    const primary = makeJsonParserError("Cannot read properties of undefined (reading 'Device')", 'json');
    const fallback = makeJsonParserError(message, 'sml');
    const result = getActivityParserDiagnostics(fallback, Buffer.from('{}'), 'json.gz', { primary, fallback });

    expect(result.jsonParserAttempts).toMatchObject([
      { parser: 'suunto_json', stage: 'primary', reason: 'missing_device_log', errorName: 'TypeError' },
      { parser: 'suunto_sml_json', stage: 'fallback', reason, errorName: 'TypeError', errorMessage: message },
    ]);
    expect(result.jsonParserAttempts?.[1].errorMessageFingerprint).toBe(result.errorMessageFingerprint);
    expect(result.jsonParserAttempts?.[0].errorMessageFingerprint).not.toBe(result.errorMessageFingerprint);
  });

  it('does not expose private data from either JSON parser error or arbitrary properties', () => {
    const sensitive = 'Alice 37.1234 https://example.test/?token=secret';
    const primary = Object.assign(makeJsonParserError(sensitive, 'json'), { cause: sensitive, file: sensitive });
    const fallback = makeJsonParserError(sensitive, 'sml');
    const result = getActivityParserDiagnostics(fallback, Buffer.from(JSON.stringify({ name: sensitive })), 'json', { primary, fallback });

    for (const attempt of result.jsonParserAttempts || []) {
      expect(attempt).toMatchObject({ reason: 'unclassified', errorMessage: 'Unclassified parser error; message withheld.' });
      expect(attempt.errorMessageFingerprint).toMatch(/^[a-f\d]{64}$/);
    }
    for (const value of ['Alice', '37.1234', 'https:', 'secret', '/private', 'cause', 'file']) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

  it('does not infer a Suunto structure error from an unrelated parser site', () => {
    const fallback = makeJsonParserError("Cannot read properties of undefined (reading 'filter')", 'json');
    const result = getActivityParserDiagnostics(fallback, Buffer.from('{}'), 'json', { primary: fallback, fallback });
    expect(result.jsonParserAttempts?.[1].reason).toBe('unclassified');
  });

  it('adds attempt diagnostics for large JSON without reparsing the payload', () => {
    const primary = makeJsonParserError("Cannot read properties of undefined (reading 'Device')", 'json');
    const fallback = makeJsonParserError("Cannot read properties of undefined (reading 'filter')", 'sml');
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const result = getActivityParserDiagnostics(fallback, Buffer.alloc((64 * 1024) + 1), 'json', { primary, fallback });
      expect(result).toMatchObject({ jsonShape: { rootType: 'not_inspected_large' } });
      expect(result.jsonParserAttempts?.[1].reason).toBe('missing_top_level_samples');
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });
});
