import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { decodeSendFile, projectSendQueue, sendIdentifier } from './policy';
describe('activity send safety', () => {
  it.each(['../other', 'a/b', '', null])('rejects unsafe references: %s', value => expect(() => sendIdentifier(value)).toThrow());
  it('rejects a gzip expansion bomb before parsing', () => expect(() => decodeSendFile(gzipSync(Buffer.alloc(21 * 1024 * 1024)), 'recording.fit.gz')).toThrow('20 MiB'));
  it('never offers resend for uncertain acceptance', () => expect(projectSendQueue({ processed: true, providerOperationStartedAt: 1 })).toMatchObject({ recovery: 'review_provider' }));
  it('checks accepted operations instead of resending', () => expect(projectSendQueue({ processed: true, destinationUploadID: 'private-canary' })).toMatchObject({ recovery: 'check_status' }));
  it('offers resend only after confirmed processing failure', () => expect(projectSendQueue({ processed: true, sendConfirmedFailure: true })).toMatchObject({ recovery: 'retry_send' }));
  it('projects a duplicate as a completed result', () => expect(projectSendQueue({ resultStatus: 'success', destinationInfoCode: 'ALREADY_EXISTS' })).toMatchObject({ status: 'duplicate', recovery: 'none' }));
  it('does not leak identifiers or arbitrary provider errors', () => {
    const result = projectSendQueue({ destinationUploadID: 'private-canary', rawError: 'sensitive-canary' });
    expect(JSON.stringify(result)).not.toContain('canary');
  });
});
