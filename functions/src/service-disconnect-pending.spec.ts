import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(vi.fn(), {
    FieldValue: {
      delete: vi.fn(),
    },
    Timestamp: {
      fromMillis: vi.fn((value: number) => ({ toMillis: () => value })),
    },
  });

  return {
    default: { firestore },
    firestore,
  };
});

vi.mock('firebase-functions/logger', () => ({
  error: vi.fn(),
}));

vi.mock('./service-token-store', () => ({
  getServiceTokenRootDocumentRef: vi.fn(),
}));

vi.mock('./service-connection-meta', () => ({
  clearServiceConnectionState: vi.fn(),
  mirrorServiceDisconnectPendingToUserMeta: vi.fn(),
}));

import { sanitizePendingServiceDisconnectErrorMessage } from './service-disconnect-pending';

describe('service-disconnect-pending', () => {
  it('redacts token material from persisted disconnect error messages', () => {
    const message = [
      'request failed',
      'Authorization: "Bearer access-token-secret"',
      'access_token=access-token-query',
      'refresh_token: "refresh-token-json"',
      'client_secret=client-secret-query',
    ].join(' ');

    const sanitized = sanitizePendingServiceDisconnectErrorMessage(message);

    expect(sanitized).toContain('Authorization: "[redacted]"');
    expect(sanitized).toContain('access_token=[redacted]');
    expect(sanitized).toContain('refresh_token: "[redacted]"');
    expect(sanitized).toContain('client_secret=[redacted]');
    expect(sanitized).not.toContain('access-token-secret');
    expect(sanitized).not.toContain('access-token-query');
    expect(sanitized).not.toContain('refresh-token-json');
    expect(sanitized).not.toContain('client-secret-query');
  });
});
