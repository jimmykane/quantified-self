import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { HttpsError } from 'firebase-functions/v2/https';
import { ACTIVITY_SEND_LIMITS } from '../../../shared/activity-send';
import { decodeSendFile, SendFileValidationError, projectSendQueue, sendIdentifier, isSendWindowOpen, sendOperationNeedsAdmission } from './policy';

function syntheticFit(headerSize = 14, dataSize = 0, byteLength = headerSize + dataSize + 2): Buffer {
  const fit = Buffer.alloc(byteLength);
  fit[0] = headerSize; fit.writeUInt32LE(dataSize, 4); fit.write('.FIT', 8, 'ascii');
  return fit;
}

describe('activity send safety', () => {
  it.each(['../other', 'a/b', '', null])('rejects unsafe references: %s', value => expect(() => sendIdentifier(value)).toThrow());
  it('rejects a gzip expansion bomb before parsing', () => expect(() => decodeSendFile(gzipSync(Buffer.alloc(21 * 1024 * 1024)), 'recording.fit.gz')).toThrow('20 MiB'));
  it.each([
    ['empty_body', () => Buffer.alloc(0), 'private.fit', 'Choose a FIT or FIT.gz file up to 20 MiB.'],
    ['file_too_large', () => Buffer.alloc(ACTIVITY_SEND_LIMITS.fileBytes + 1), 'private.fit', 'Choose a FIT or FIT.gz file up to 20 MiB.'],
    ['unsupported_extension', () => syntheticFit(), 'private@example.com.txt', 'Choose a FIT or FIT.gz file up to 20 MiB.'],
    ['invalid_gzip', () => Buffer.from('private-file-content'), 'private.fit.gz', 'FIT.gz cannot be expanded within 20 MiB.'],
    ['gzip_output_too_large', () => gzipSync(Buffer.alloc(ACTIVITY_SEND_LIMITS.fileBytes + 1)), 'private.fit.gz', 'FIT.gz cannot be expanded within 20 MiB.'],
    ['too_short', () => Buffer.alloc(1), 'private.fit', 'The selected file is not a complete FIT recording.'],
    ['invalid_header_size', () => syntheticFit(13), 'private.fit', 'The selected file is not a complete FIT recording.'],
    ['missing_fit_signature', () => { const fit = syntheticFit(); fit.fill(0, 8, 12); return fit; }, 'private.fit', 'The selected file is not a complete FIT recording.'],
    ['truncated_header', () => syntheticFit(14, 0, 12), 'private.fit', 'The selected file is not a complete FIT recording.'],
    ['truncated_payload', () => syntheticFit(14, 100, 16), 'private.fit', 'The selected file is not a complete FIT recording.'],
    ['truncated_payload', () => gzipSync(syntheticFit(14, 100, 16)), 'private.fit.gz', 'The selected file is not a complete FIT recording.'],
  ] as const)('classifies %s without changing the public rejection', (reason, body, filename, message) => {
    const input = body();
    let failure: unknown;
    try { decodeSendFile(input, filename); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(HttpsError);
    expect(failure).toBeInstanceOf(SendFileValidationError);
    expect(failure).toMatchObject({ code: 'invalid-argument', message, validationReason: reason, receivedBytes: input.length });
  });
  it('still accepts complete FIT and FIT.gz envelopes', () => {
    const fit = syntheticFit();
    expect(decodeSendFile(fit, 'recording.FIT')).toBe(fit);
    expect(decodeSendFile(gzipSync(fit), 'recording.FIT.GZ')).toEqual(fit);
  });
  it('never offers resend for uncertain acceptance', () => expect(projectSendQueue({ processed: true, providerOperationStartedAt: 1 })).toMatchObject({ recovery: 'review_provider' }));
  it('does not offer connection resume for a paused provider claim with no accepted identifier', () => expect(projectSendQueue({ deferredReason: 'service_reconnect_required', providerOperationStartedAt: 1, processed: false })).toMatchObject({ recovery: 'review_provider' }));
  it('checks accepted operations instead of resending', () => expect(projectSendQueue({ processed: true, destinationUploadID: 'private-canary' })).toMatchObject({ recovery: 'check_status' }));
  it('offers conditional recovery after confirmed processing failure without promising an available retry', () => {
    const result = projectSendQueue({ processed: true, sendConfirmedFailure: true });
    expect(result).toMatchObject({ recovery: 'retry_send' });
    expect(result.message).toContain('confirmed processing failed');
    expect(result.message).not.toContain('You can retry');
  });
  it('projects a duplicate as a completed result', () => expect(projectSendQueue({ resultStatus: 'success', destinationInfoCode: 'ALREADY_EXISTS' })).toMatchObject({ status: 'duplicate', recovery: 'none' }));
  it('does not leak identifiers or arbitrary provider errors', () => {
    const result = projectSendQueue({ destinationUploadID: 'private-canary', rawError: 'sensitive-canary' });
    expect(JSON.stringify(result)).not.toContain('canary');
  });
  it.each([undefined, {}, { state: 'draft', expiresAt: 200 }, { state: 'confirmed', expiresAt: 100 }, { state: 'confirmed', expiresAt: '200' }, { state: 'confirmed', expiresAt: 200, stopped: true }])('refuses closed or malformed sending authority: %j', operation => {
    expect(isSendWindowOpen(operation, 100)).toBe(false);
  });
  it('permits only a current confirmed sending window', () => expect(isSendWindowOpen({ state: 'confirmed', expiresAt: 101 }, 100)).toBe(true));
  it('ignores unchanged and projection-only operation writes', () => {
    const before = { state: 'confirmed', finished: 0, updatedAt: 1, savedSelection: { sources: ['manualUpload'] } };
    expect(sendOperationNeedsAdmission(before, { ...before })).toBe(false);
    expect(sendOperationNeedsAdmission(before, { ...before, finished: 1, updatedAt: 2, savedSelection: { sources: ['manualUpload'] } })).toBe(false);
  });
  it.each([
    { state: 'confirmed' }, { stopped: true }, { revision: 2 }, { total: 2 },
    { admissionProgressAt: 2 }, { stopCursor: 'next-row' }, { stopComplete: true },
    { sourceCleanupProgressAt: 2 }, { sourceCleanupRevision: 2 },
  ])('preserves admission and cleanup control changes: %j', control => {
    const before = { state: 'draft', finished: 0, updatedAt: 1 };
    expect(sendOperationNeedsAdmission(before, { ...before, ...control, updatedAt: 2 })).toBe(true);
  });
  it('handles created operations and removed control fields', () => {
    expect(sendOperationNeedsAdmission(undefined, { state: 'draft' })).toBe(true);
    expect(sendOperationNeedsAdmission({ state: 'confirmed', stopCursor: 'old' }, { state: 'confirmed' })).toBe(true);
  });
});
