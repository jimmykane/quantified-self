import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { decodeSendFile, projectSendQueue, sendIdentifier, isSendWindowOpen } from './policy';
describe('activity send safety', () => {
  it.each(['../other', 'a/b', '', null])('rejects unsafe references: %s', value => expect(() => sendIdentifier(value)).toThrow());
  it('rejects a gzip expansion bomb before parsing', () => expect(() => decodeSendFile(gzipSync(Buffer.alloc(21 * 1024 * 1024)), 'recording.fit.gz')).toThrow('20 MiB'));
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
});
