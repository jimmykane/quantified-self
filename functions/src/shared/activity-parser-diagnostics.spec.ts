import { describe, expect, it } from 'vitest';
import { getActivityParserDiagnostics } from './activity-parser-diagnostics';
import { SPORTS_LIB_VERSION } from './sports-lib-version.node';

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
      parserSite: { package: 'sports-lib', line: 242, column: 12 },
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
});
