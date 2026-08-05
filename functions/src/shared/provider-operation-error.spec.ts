import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  isProviderOperationError,
  isTerminalServiceAuthError,
  isTransientProviderTransportError,
  ProviderOperationError,
} from './provider-operation-error';

describe('ProviderOperationError', () => {
  it('preserves an explicit provider retry decision', () => {
    const error = new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      retryMode: 'restart',
      code: 'provider_internal_error',
      message: 'Suunto processing failed: Internal error',
      statusCode: 500,
      providerUserId: 'suunto-user-1',
      providerOperationId: 'upload-1',
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    });

    expect(isProviderOperationError(error)).toBe(true);
    expect(error).toMatchObject({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      retryMode: 'restart',
      code: 'provider_internal_error',
      statusCode: 500,
      providerUserId: 'suunto-user-1',
      providerOperationId: 'upload-1',
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    });
  });

  it('defaults retryable failures to restarting and terminal failures to no retry', () => {
    const retryable = new ProviderOperationError({
      serviceName: ServiceNames.WahooAPI,
      operation: 'route_upload',
      disposition: 'retryable',
      code: 'provider_unavailable',
      message: 'Unavailable',
    });
    const permanent = new ProviderOperationError({
      serviceName: ServiceNames.GarminAPI,
      operation: 'route_create',
      disposition: 'permanent',
      code: 'provider_rejected',
      message: 'Rejected',
    });

    expect(retryable.retryMode).toBe('restart');
    expect(permanent.retryMode).toBe('none');
  });

  it('normalizes contradictory retry modes to the failure disposition', () => {
    const retryable = new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      retryMode: 'none',
      code: 'unavailable',
      message: 'Temporary failure',
    });
    const permanent = new ProviderOperationError({
      serviceName: ServiceNames.GarminAPI,
      operation: 'route_create',
      disposition: 'permanent',
      retryMode: 'resume',
      code: 'failed-precondition',
      message: 'Rejected',
    });

    expect(retryable.retryMode).toBe('restart');
    expect(permanent.retryMode).toBe('none');
  });

  it('does not coerce absent numeric metadata to zero', () => {
    const error = new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      code: 'unavailable',
      message: 'Temporary failure',
      statusCode: null as unknown as number,
      retryAfterSeconds: '   ' as unknown as number,
    });

    expect(error.statusCode).toBeUndefined();
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('recognizes the canonical terminal auth error across module boundaries', () => {
    const error = Object.assign(new Error('Reconnect required'), {
      name: 'TerminalServiceAuthError',
      providerUserId: 'provider-user-1',
    });

    expect(isTerminalServiceAuthError(error)).toBe(true);
    expect(isTerminalServiceAuthError({
      name: 'TerminalServiceAuthError',
      message: 'Reconnect required',
      dlqContext: 'AUTH_RECONNECT_REQUIRED',
    })).toBe(true);
    expect(isTerminalServiceAuthError(new Error('Other failure'))).toBe(false);
  });

  it('redacts common credentials and URLs from persisted error text', () => {
    const error = new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'permanent',
      code: 'provider_rejected',
      message: 'Bearer secret-token access_token=abc client_secret: "def" token = plain authorization: Basic credentials https://provider.example/upload?sig=secret',
    });

    expect(error.message).toBe('Bearer [redacted] access_token=[redacted] client_secret=[redacted] token=[redacted] authorization=[redacted] [url]');
    expect(error.message).not.toContain('secret-token');
    expect(error.message).not.toContain('abc');
    expect(error.message).not.toContain('def');
    expect(error.message).not.toContain('plain');
    expect(error.message).not.toContain('credentials');
  });

  it.each([
    Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }),
    Object.assign(new Error('request failed'), { name: 'RequestError' }),
    Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }),
  ])('recognizes status-less provider transport failures', (error) => {
    expect(isTransientProviderTransportError(error)).toBe(true);
  });

  it('does not classify an unknown provider or validation error as transport failure', () => {
    expect(isTransientProviderTransportError(new Error('Invalid route payload'))).toBe(false);
    expect(isTransientProviderTransportError({ statusCode: 400 })).toBe(false);
  });
});
