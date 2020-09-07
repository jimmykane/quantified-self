import * as Pako from 'pako';
import { Log } from 'ng2-logger/browser';
import { gzip_decode, gzip_decode_raw } from 'wasm-flate';
import { firestore } from 'firebase/app';
import { getSize, getSizeFormated } from '@sports-alliance/sports-lib/lib/events/utilities/helpers';
import { StreamJSONInterface } from '@sports-alliance/sports-lib/lib/streams/stream';
import {
  CompressedJSONStreamInterface,
  CompressionEncodings, CompressionMethods
} from '@sports-alliance/sports-lib/lib/streams/compressed.stream.interface';

export class StreamEncoder {
  private static logger = Log.create('StreamEncoder');

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
    this.logger.info(`[ORIGINAL] ${stream.type} = ${getSizeFormated(compressedStream.data)}`)
    // If we can fit it go on
    if (getSize(compressedStream.data) <= 1048487) {
      return compressedStream
    }
    // Then try Pako (as the fastest)
    compressedStream.data = firestore.Blob.fromUint8Array(Pako.gzip(JSON.stringify(stream.data)));
    compressedStream.encoding = CompressionEncodings.UInt8Array
    compressedStream.compressionMethod = CompressionMethods.Pako
    this.logger.info(`[COMPRESSED ${CompressionMethods.Pako}] ${stream.type} = ${getSizeFormated(compressedStream.data)}`)
    if (getSize(compressedStream.data) <= 1048487) {
      return compressedStream
    }
    // Throw an error if smaller than a MB still
    throw new Error(`Cannot compress stream ${stream.type} its more than 1048487 bytes  ${getSize(compressedStream.data)}`)
  }

  static decompressStream(compressedStreamJSON: CompressedJSONStreamInterface): StreamJSONInterface {
    // const blobNew =  firestore.Blob
    // const P = Pako
    // const size = getSizeFormated
    // const gz = gzip_decode_raw
    // debugger
    const t0 = performance.now();
    const stream = {
      type: compressedStreamJSON.type,
      data: null
    };
    switch (compressedStreamJSON.compressionMethod) {
      default:
        // Assume legacy = Pako + Firestore Blob + base64
        stream.data = gzip_decode(compressedStreamJSON.data.toBase64())
        break;
      case CompressionMethods.None:
        stream.data = compressedStreamJSON.data
        break;
      case CompressionMethods.Pako: // Pako is the default here
        const t2 = performance.now();
        Pako.ungzip(compressedStreamJSON.data.toUint8Array(), {to: 'string'});
        const t3 = performance.now()
        this.logger.info(`Decompression PPP took ${t3 - t2}`);

        const t4 = performance.now();
        new TextDecoder().decode(gzip_decode_raw(compressedStreamJSON.data.toUint8Array()))
        const t5 = performance.now()
        this.logger.info(`Decompression with FGG took ${t5 - t4}`);


        stream.data = compressedStreamJSON.encoding === CompressionEncodings.Binary
          ? gzip_decode(btoa(compressedStreamJSON.data))
          : Pako.ungzip(compressedStreamJSON.data.toUint8Array(), {to: 'string'});
        break;
      // case CompressionMethods.LZUTF8:
      //   stream.data = LZUTF8.decompress(compressedStreamJSON.data, {inputEncoding: 'StorageBinaryString'});
      //   break;
    }
    const t1 = performance.now();
    this.logger.info(`Decompression with ${compressedStreamJSON.compressionMethod} took ${t1 - t0}`);
    stream.data = JSON.parse(stream.data);
    return stream;
  }

}
