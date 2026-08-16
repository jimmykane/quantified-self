import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetBinaryResponse } = vi.hoisted(() => ({
  mockGetBinaryResponse: vi.fn(),
}));

vi.mock('../config', () => ({
  config: {
    suuntoapp: { subscription_key: 'test-subscription-key' },
  },
}));

vi.mock('../request-helper', () => {
  return {
    getBinaryResponse: (...args: unknown[]) => mockGetBinaryResponse(...args),
  };
});

import {
  downloadSuuntoFITFile,
  isSuspiciouslySmallSuuntoFIT,
  RetryableSuuntoFITPayloadError,
} from './fit-download';

function createSyntheticFitPayload(dataBytes: Buffer): Buffer {
  const headerSize = 14;
  const result = Buffer.alloc(headerSize + dataBytes.length + 2);
  result.writeUInt8(headerSize, 0);
  result.writeUInt8(0x20, 1);
  result.writeUInt32LE(dataBytes.length, 4);
  result.write('.FIT', 8, 'ascii');
  dataBytes.copy(result, headerSize);
  return result;
}

describe('downloadSuuntoFITFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses provider-compliant authorization without a timeout or body limit and returns a complete FIT', async () => {
    const fit = createSyntheticFitPayload(Buffer.from([0x01, 0x02, 0x03]));
    mockGetBinaryResponse.mockResolvedValue({
      body: fit,
      statusCode: 200,
      contentType: 'application/octet-stream',
      contentLength: fit.length,
    });

    await expect(downloadSuuntoFITFile('raw-access-token', 'workout/with space')).resolves.toEqual(fit);

    expect(mockGetBinaryResponse).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'application/octet-stream',
        Authorization: 'Bearer raw-access-token',
        'Ocp-Apim-Subscription-Key': 'test-subscription-key',
      }),
      url: 'https://cloudapi.suunto.com/v3/workouts/workout%2Fwith%20space/fit',
    }));
    expect(mockGetBinaryResponse.mock.calls[0][0]).not.toHaveProperty('maxResponseBytes');
    expect(mockGetBinaryResponse.mock.calls[0][0]).not.toHaveProperty('timeout');
  });

  it('does not double-prefix an existing Bearer token', async () => {
    const fit = createSyntheticFitPayload(Buffer.from([0x01]));
    mockGetBinaryResponse.mockResolvedValue({
      body: fit,
      statusCode: 200,
      contentType: 'application/vnd.ant.fit',
      contentLength: fit.length,
    });

    await downloadSuuntoFITFile('Bearer existing-token', 'workout-1');

    expect(mockGetBinaryResponse).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer existing-token' }),
    }));
  });

  it('unwraps a multipart response before validating it', async () => {
    const fit = createSyntheticFitPayload(Buffer.from([0x0a, 0x0b]));
    const boundary = '------SuuntoFitBoundary';
    const multipart = Buffer.concat([
      Buffer.from(
        `${boundary}\r\nContent-Disposition: form-data; name="file"; filename="activity.fit"\r\n`
          + 'Content-Type: application/octet-stream\r\n\r\n',
        'latin1',
      ),
      fit,
      Buffer.from(`\r\n${boundary}--\r\n`, 'latin1'),
    ]);
    mockGetBinaryResponse.mockResolvedValue({
      body: multipart,
      statusCode: 200,
      contentType: 'multipart/form-data',
      contentLength: multipart.length,
    });

    await expect(downloadSuuntoFITFile('token', 'workout-1')).resolves.toEqual(fit);
  });

  it('classifies a tiny JSON provider body as retryable without retaining its contents', async () => {
    const body = Buffer.from('{"privateProviderMessage":"not ready"}', 'utf8');
    mockGetBinaryResponse.mockResolvedValue({
      body,
      statusCode: 200,
      contentType: 'application/json; charset=utf-8',
      contentLength: body.length,
    });

    await expect(downloadSuuntoFITFile('token', 'workout-1')).rejects.toMatchObject({
      name: 'RetryableSuuntoFITPayloadError',
      byteLength: body.length,
      contentTypeCategory: 'json',
      reason: 'invalid_header_size',
      message: expect.not.stringContaining('privateProviderMessage'),
    });
  });

  it('classifies an incomplete FIT body as retryable', async () => {
    const fit = createSyntheticFitPayload(Buffer.alloc(100));
    const truncated = fit.subarray(0, 30);
    mockGetBinaryResponse.mockResolvedValue({
      body: truncated,
      statusCode: 200,
      contentType: 'application/octet-stream',
      contentLength: truncated.length,
    });

    await expect(downloadSuuntoFITFile('token', 'workout-1')).rejects.toMatchObject({
      name: 'RetryableSuuntoFITPayloadError',
      byteLength: truncated.length,
      contentTypeCategory: 'binary',
      reason: 'truncated_payload',
    });
  });

  it('accepts a complete FIT response without the optional file CRC', async () => {
    const fit = createSyntheticFitPayload(Buffer.from([0x01, 0x02, 0x03]));
    const withoutFileCRC = fit.subarray(0, fit.length - 2);
    mockGetBinaryResponse.mockResolvedValue({
      body: withoutFileCRC,
      statusCode: 200,
      contentType: 'application/octet-stream',
      contentLength: withoutFileCRC.length,
    });

    await expect(downloadSuuntoFITFile('token', 'workout-1')).resolves.toEqual(withoutFileCRC);
  });

  it('identifies only bounded sessionless FITs as suspiciously small', () => {
    expect(isSuspiciouslySmallSuuntoFIT(90)).toBe(true);
    expect(isSuspiciouslySmallSuuntoFIT(512)).toBe(true);
    expect(isSuspiciouslySmallSuuntoFIT(513)).toBe(false);
    expect(isSuspiciouslySmallSuuntoFIT(-1)).toBe(false);
  });

  it('exports the retryable error type for queue classification', () => {
    expect(new RetryableSuuntoFITPayloadError('too_short', 0, 'missing'))
      .toBeInstanceOf(RetryableSuuntoFITPayloadError);
  });
});
