import { describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import { getAssistantErrorDiagnostic } from './error-diagnostics';

describe('Assistant error diagnostics', () => {
  it.each([new Error(), new TypeError(), new RangeError(), new SyntaxError()])(
    'reports a fixed built-in type, never the authored error name or content', error => {
      const type = error.constructor.name;
      Object.assign(error, { name: 'private-user-id', message: 'private-prompt', stack: 'private-token',
        code: 'private-email@example.invalid', cause: { title: 'private-activity' } });
      expect(getAssistantErrorDiagnostic(error)).toEqual({ causeErrorType: type, causeErrorCode: 'unknown' });
    },
  );

  it.each(['ETIMEDOUT', 'ECONNRESET', 'app/network-error', 'unavailable', 14, -32603])(
    'retains only a known transport/service code: %s', code => {
      expect(getAssistantErrorDiagnostic(Object.assign(new Error('private-url'), { code })))
        .toEqual({ causeErrorType: 'Error', causeErrorCode: String(code) });
    },
  );

  it.each([17, -1, 14.5, NaN, Infinity, '14', 'ECONNRESET private-token', { privateToken: 'secret' }])(
    'excludes an unknown or malformed code: %s', code => {
      expect(getAssistantErrorDiagnostic(Object.assign(new Error('private'), { code })))
        .toEqual({ causeErrorType: 'Error', causeErrorCode: 'unknown' });
    },
  );

  it('does not invoke error getters or follow private nested causes', () => {
    const get = vi.fn(() => { throw new Error('private-secret'); });
    const error = Object.defineProperties(new Error(), {
      name: { get }, code: { get }, message: { get }, stack: { get }, cause: { get },
    });
    expect(getAssistantErrorDiagnostic(error)).toEqual({ causeErrorType: 'Error', causeErrorCode: 'unknown' });
    expect(get).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 'private-token', { name: 'private-name', message: 'private-prompt' }])(
    'does not serialize non-error values', error => {
      expect(getAssistantErrorDiagnostic(error)).toEqual({ causeErrorType: 'unknown', causeErrorCode: 'unknown' });
    },
  );

  it('cannot throw while inspecting a hostile object', () => {
    const error = new Proxy({}, { getPrototypeOf: () => { throw new Error('private'); } });
    expect(getAssistantErrorDiagnostic(error)).toEqual({ causeErrorType: 'unknown', causeErrorCode: 'unknown' });
  });

  it('identifies real schema failures without rejected values or unknown keys', () => {
    const result = z.object({ title: z.string().min(2), timeZone: z.string() }).strict()
      .safeParse({ title: '', timeZone: { token: 'private-token' }, 'private-user-id': 'private-prompt' });
    expect(result.success).toBe(false);
    expect(getAssistantErrorDiagnostic(result.error)).toEqual({
      causeErrorType: 'ZodError', causeErrorCode: 'unknown',
      causeSchemaIssues: [
        { code: 'too_small', path: '$.title' },
        { code: 'invalid_type', path: '$.timeZone' },
        { code: 'unrecognized_keys', path: '$' },
      ],
    });
  });

  it('bounds issue count/path depth and masks dynamic keys, symbols and indexes', () => {
    const error = new ZodError(Array.from({ length: 30 }, () => ({
      code: 'custom', message: 'private-prompt', params: { token: 'private-token' },
      path: ['changes', 123, 'structure', 'nodes', 456, 'private-user-id', Symbol('private-email'), 'title', 'private-extra'],
    })));
    const diagnostic = getAssistantErrorDiagnostic(error);
    expect(diagnostic.causeSchemaIssues).toEqual(Array.from({ length: 5 }, () => ({
      code: 'custom', path: '$.changes.*.structure.nodes.*.<field>.<field>.title.…',
    })));
    expect(JSON.stringify(diagnostic)).not.toMatch(/private|123|456/);
  });

  it('never logs arbitrary issue codes, union details or received values', () => {
    const error = new ZodError([{
      code: 'private-code', message: 'private-message', path: ['private-path'],
      errors: [[{ message: 'private-union' }]], input: 'private-input',
    } as never]);
    expect(getAssistantErrorDiagnostic(error).causeSchemaIssues).toEqual([{ code: 'unknown', path: '$.<field>' }]);
  });
});
