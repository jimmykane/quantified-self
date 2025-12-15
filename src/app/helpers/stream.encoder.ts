import * as Pako from 'pako';
import { Bytes } from 'firebase/firestore';
import { getSize } from '@sports-alliance/sports-lib';
import { StreamJSONInterface } from '@sports-alliance/sports-lib';

import {
  CompressedJSONStreamInterface,
  CompressionEncodings,
  CompressionMethods
} from '@sports-alliance/sports-lib';

export class StreamEncoder {

  /**
   * Make sure this is in sync with the functions based one
   * @param stream
   */
  static compressStream(stream: StreamJSONInterface): CompressedJSONStreamInterface {
    const compressedStream: CompressedJSONStreamInterface = {
      encoding: CompressionEncodings.None,
      type: stream.type,
      data: JSON.stringify(stream.data),
      compressionMethod: CompressionMethods.None
    }

    // If we can fit it go on
    if (getSize(compressedStream.data) <= 1048487) {
      return compressedStream
    }
    // Then try Pako (as the fastest)
    compressedStream.data = Bytes.fromUint8Array(Pako.gzip(JSON.stringify(stream.data)));
    compressedStream.encoding = CompressionEncodings.UInt8Array
    compressedStream.compressionMethod = CompressionMethods.Pako

    if (getSize(compressedStream.data) <= 1048487) {
      return compressedStream
    }
    // Throw an error if smaller than a MB still
    throw new Error(`Cannot compress stream ${stream.type} its more than 1048487 bytes  ${getSize(compressedStream.data)}`)
  }

  static decompressStream(compressedStreamJSON: CompressedJSONStreamInterface): StreamJSONInterface {
    const t0 = performance.now();
    const stream = {
      type: compressedStreamJSON.type,
      data: null
    };
    switch (compressedStreamJSON.compressionMethod) {
      case CompressionMethods.None:
        stream.data = compressedStreamJSON.data
        break;
      default:
      case CompressionMethods.Pako: // Pako is the default here
        stream.data = compressedStreamJSON.encoding === CompressionEncodings.Binary
          ? Pako.ungzip(compressedStreamJSON.data.toBase64(), { to: 'string' })
          : Pako.ungzip(compressedStreamJSON.data.toUint8Array(), { to: 'string' });
        break;
    }
    const t1 = performance.now();

    stream.data = JSON.parse(stream.data);
    return stream;
  }

}
