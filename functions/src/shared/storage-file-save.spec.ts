import { describe, expect, it, vi } from 'vitest';
import { CRC32C, Storage } from '@google-cloud/storage';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { saveChecksummedStorageFile } from './storage-file-save';

describe('saveChecksummedStorageFile', () => {
    it.each([
        ['Buffer', Buffer.from('123456789')],
        ['string', '123456789'],
        ['Uint8Array slice', Uint8Array.from([0xff, ...Buffer.from('123456789'), 0xee]).subarray(1, 10)],
    ])('sends the reference CRC32C for %s without including surrounding bytes', async (_label, data) => {
        const save = vi.fn().mockResolvedValue(undefined);

        await saveChecksummedStorageFile({ save }, data);

        expect(save).toHaveBeenCalledExactlyOnceWith(Buffer.from('123456789'), {
            validation: 'crc32c',
            metadata: { crc32c: '4waSgw==' },
        });
    });

    it('preserves already compressed bytes and hashes the stored representation', async () => {
        const bytes = gzipSync(Buffer.from('<gpx>Δ</gpx>'));
        const checksum = new CRC32C();
        checksum.update(bytes);
        const save = vi.fn().mockResolvedValue(undefined);

        await saveChecksummedStorageFile({ save }, bytes);

        expect(save).toHaveBeenCalledExactlyOnceWith(bytes, {
            validation: 'crc32c',
            metadata: { crc32c: checksum.toString() },
        });
        expect(save.mock.calls[0][0]).toBe(bytes);
    });

    it('supports an empty buffer', async () => {
        const save = vi.fn().mockResolvedValue(undefined);

        await saveChecksummedStorageFile({ save }, Buffer.alloc(0));

        expect(save).toHaveBeenCalledExactlyOnceWith(Buffer.alloc(0), {
            validation: 'crc32c',
            metadata: { crc32c: 'AAAAAA==' },
        });
    });

    it('propagates a Storage rejection to the caller', async () => {
        const failure = Object.assign(new Error('checksum mismatch'), { code: 400 });
        const save = vi.fn().mockRejectedValue(failure);

        await expect(saveChecksummedStorageFile({ save }, Buffer.from('123456789')))
            .rejects.toBe(failure);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('uses the real SDK with server-side corruption detection (corrupt=%s)', async corrupt => {
        let suppliedChecksum: string | undefined;
        let uploadedBytes: Buffer | undefined;
        let storedBytes: Buffer | undefined;
        const requests: string[] = [];
        const source = Buffer.from('<gpx>Δ</gpx>');
        const server = createServer(async (request, response) => {
            requests.push(request.method || '');
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const body = Buffer.concat(chunks);

            if (request.method === 'POST') {
                suppliedChecksum = JSON.parse(body.toString()).crc32c;
                response.writeHead(200, {
                    Location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/session`,
                }).end();
                return;
            }
            if (request.method === 'PUT' && request.url === '/session') {
                uploadedBytes = body;
                const received = Buffer.from(body);
                if (corrupt) received[0] ^= 1;
                const checksum = new CRC32C();
                checksum.update(received);
                if (checksum.toString() !== suppliedChecksum) {
                    response.writeHead(400, { 'Content-Type': 'application/json' })
                        .end(JSON.stringify({ error: { code: 400, message: 'CRC32C mismatch' } }));
                    return;
                }
                storedBytes = received;
                response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                    name: 'original.gpx',
                    size: received.length.toString(),
                    generation: '1',
                    crc32c: suppliedChecksum,
                }));
                return;
            }
            response.writeHead(500).end('Unexpected SDK request');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const storage = new Storage({
                projectId: 'test-project',
                apiEndpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
                retryOptions: { autoRetry: false, maxRetries: 0 },
            });
            const upload = saveChecksummedStorageFile(storage.bucket('test-bucket').file('original.gpx'), source);
            if (corrupt) {
                await expect(upload).rejects.toMatchObject({ code: 400 });
                expect(storedBytes).toBeUndefined();
            } else {
                await expect(upload).resolves.toBeUndefined();
                expect(storedBytes).toEqual(source);
            }
            const expectedChecksum = new CRC32C();
            expectedChecksum.update(source);
            expect(suppliedChecksum).toBe(expectedChecksum.toString());
            expect(uploadedBytes).toEqual(source);
            expect(requests).toEqual(['POST', 'PUT']);
        } finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
