import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';
import type { Readable } from 'node:stream';
import type { SuuntoGuideJsonV1 } from '../../providers/suunto-guide.serializer';
import { TrainingDeliveryTransportError } from '../contracts';
import { GUIDE_RESPONSE_BYTES, object } from './http';

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, body, tail]);
}
/** Fixed, non-personal interval-bars icon. Generated once, never from workout/user data. */
function guideIcon(): Buffer {
  const size = 300; const pixels = Buffer.alloc(size * (size * 3 + 1), 0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const bar = x >= 55 && x < 245 && (x - 55) % 70 < 50 && y > [155, 75, 115][Math.floor((x - 55) / 70)] && y < 240;
    const offset = y * (size * 3 + 1) + 1 + x * 3;
    pixels.set(bar ? [255, 255, 255] : [20, 106, 160], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const ICON = guideIcon();
export async function packageGuide(guide: SuuntoGuideJsonV1): Promise<Buffer> {
  const zip = new JSZip(); const options = { date: new Date('2000-01-01T00:00:00Z') };
  zip.file('guide.json', JSON.stringify(guide), options); zip.file('icon.png', ICON, options);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
/** Bound decompression while streaming; an archive's declared size is not trusted. */
export async function readGuideArchive(value: unknown): Promise<Record<string, unknown>> {
  try {
    if (!Buffer.isBuffer(value) || value.length > GUIDE_RESPONSE_BYTES) throw new Error();
    const zip = await JSZip.loadAsync(value);
    const entry = zip.file('guide.json');
    if (!entry || Object.keys(zip.files).length > 4) throw new Error();
    const data = await new Promise<Buffer>((resolve, reject) => {
      const stream = entry.nodeStream() as Readable; const parts: Buffer[] = []; let size = 0;
      stream.on('data', (part: Buffer) => {
        size += part.length;
        if (size > 256 * 1024) stream.destroy(new Error('size')); else parts.push(part);
      });
      stream.on('error', reject); stream.on('end', () => resolve(Buffer.concat(parts)));
    });
    return object(JSON.parse(data.toString('utf8')));
  } catch { throw new TrainingDeliveryTransportError('uncertain'); }
}
