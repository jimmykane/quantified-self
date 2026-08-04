import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  isProviderOperationError,
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

  it('redacts common credentials and URLs from persisted error text', () => {
    const error = new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'permanent',
      code: 'provider_rejected',
      message: 'Bearer secret-token access_token=abc client_secret: "def" https://provider.example/upload?sig=secret',
    });

    expect(error.message).toBe('Bearer [redacted] access_token=[redacted] client_secret: "[redacted]" [url]');
    expect(error.message).not.toContain('secret-token');
    expect(error.message).not.toContain('abc');
    expect(error.message).not.toContain('def');
  });
});
