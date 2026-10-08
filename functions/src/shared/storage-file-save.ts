import type { File } from '@google-cloud/storage';

/**
 * Validate the exact retained bytes on the server before committing an object,
 * as well as checking the returned checksum on the client.
 */
export async function saveChecksummedStorageFile(
    file: Pick<File, 'save'>,
    data: Buffer | Uint8Array | string,
): Promise<void> {
    // Keep Storage lazy: shared callers also serve functions which never upload.
    const { CRC32C } = await import('@google-cloud/storage');
    const bytes = typeof data === 'string'
        ? Buffer.from(data, 'utf8')
        : Buffer.isBuffer(data) ? data : Buffer.from(data);
    const checksum = new CRC32C();
    checksum.update(bytes);

    await file.save(bytes, {
        validation: 'crc32c',
        metadata: { crc32c: checksum.toString() },
    });
}
