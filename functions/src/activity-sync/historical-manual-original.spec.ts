import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'zlib';
import { createHash } from 'crypto';

const { getMetadata, download } = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  download: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  storage: () => ({
    bucket: () => ({ file: () => ({ getMetadata, download }) }),
  }),
}));

import { isOwnerOriginalPath, matchesLegacyManualUploadID, readHistoricalManualFit } from './historical-manual-original';

function fitPayload(): Buffer {
  const fit = Buffer.alloc(14);
  fit[0] = 12;
  fit.write('.FIT', 8, 'ascii');
  return fit;
}

describe('historical manual original', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMetadata.mockResolvedValue([{ generation: '42', size: '14' }]);
    download.mockResolvedValue([fitPayload()]);
  });

  it('proves a legacy upload from its original FIT bytes and owner-scoped path', async () => {
    const fit = fitPayload();
    const eventID = createHash('sha256').update('fit:user-1:').update(fit).digest('hex');
    expect(matchesLegacyManualUploadID('user-1', eventID, fit)).toBe(true);
    expect(matchesLegacyManualUploadID('user-2', eventID, fit)).toBe(false);
    expect(isOwnerOriginalPath('user-1', eventID, `users/user-2/events/${eventID}/original.fit`)).toBe(false);
    await expect(readHistoricalManualFit('user-1', eventID, {
      path: `users/user-1/events/${eventID}/original.fit`, generation: '42',
    })).resolves.toEqual({ fit, generation: '42' });
  });

  it('safely expands a retained .fit.gz and returns the FIT', async () => {
    const fit = fitPayload();
    const gz = gzipSync(fit);
    getMetadata.mockResolvedValue([{ generation: '42', size: `${gz.length}` }]);
    download.mockResolvedValue([gz]);
    await expect(readHistoricalManualFit('user-1', 'event-1', {
      path: 'users/user-1/events/event-1/original.fit.gz', generation: '42',
    })).resolves.toEqual({ fit, generation: '42' });
  });

  it('rejects a changed generation and oversized original before delivery', async () => {
    await expect(readHistoricalManualFit('user-1', 'event-1', {
      path: 'users/user-1/events/event-1/original.fit', generation: '41',
    })).rejects.toThrow('changed');
    getMetadata.mockResolvedValue([{ generation: '42', size: `${21 * 1024 * 1024}` }]);
    await expect(readHistoricalManualFit('user-1', 'event-1', {
      path: 'users/user-1/events/event-1/original.fit', generation: '42',
    })).rejects.toThrow('limit');
    expect(download).not.toHaveBeenCalled();
  });
});
