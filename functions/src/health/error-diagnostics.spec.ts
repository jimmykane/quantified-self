import { describe, expect, it } from 'vitest';
import { getHealthFailureTelemetry } from './error-diagnostics';

describe('Health failure diagnostics', () => {
  it.each([4, 10, 14])('retains RPC code %s without exception text or credential data', code => {
    const error = Object.assign(new Error('private-token/private-path'), {
      code, details: 'private-health', cause: new Error('private-cause'), response: { body: 'private-body' },
    });
    const telemetry = getHealthFailureTelemetry(error, 'failure_state_write', 42);
    expect(telemetry).toEqual({ errorName: 'Error', failureCategory: 'rpc_error', rpcStatusCode: code,
      failureStage: 'failure_state_write', processingElapsedMs: 42 });
    expect(JSON.stringify(telemetry)).not.toContain('private');
  });

  it.each(['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'])('retains only allowlisted transport code %s', code => {
    expect(getHealthFailureTelemetry(Object.assign(new Error('private'), { code }), 'callback_request', 5))
      .toMatchObject({ failureCategory: 'transport_error', transportCode: code });
  });

  it.each([null, { name: 'private-name', code: 'private-code', transportCode: 'private-code' },
    { get name() { throw new Error('private-getter'); } },
    { get code() { throw new Error('private-getter'); } }])('fails closed for unknown or hostile errors (%#)', error => {
    expect(getHealthFailureTelemetry(error, 'private-stage', Infinity)).toEqual({
      errorName: 'UnknownError', failureCategory: 'unclassified', failureStage: 'unknown', processingElapsedMs: 0,
    });
  });

  it('bounds durations and rejects invalid numeric codes', () => {
    expect(getHealthFailureTelemetry(new TypeError('private'), 'health_write', -1))
      .toMatchObject({ errorName: 'TypeError', processingElapsedMs: 0 });
    expect(getHealthFailureTelemetry({ code: 99 }, 'health_write', 9_999_999))
      .toEqual({ errorName: 'UnknownError', failureCategory: 'unclassified', failureStage: 'health_write', processingElapsedMs: 1_800_000 });
  });

  it('recognizes native fetch cancellation without claiming an upstream HTTP status', () => {
    const telemetry = getHealthFailureTelemetry(new DOMException('private-deadline', 'AbortError'), 'callback_request', 30_000);
    expect(telemetry).toMatchObject({ failureCategory: 'transport_error', transportCode: 'ABORT_ERR' });
    expect(telemetry).not.toHaveProperty('providerStatusCode');
    expect(JSON.stringify(telemetry)).not.toContain('private');
  });
});
