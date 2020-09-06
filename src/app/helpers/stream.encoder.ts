import * as Pako from 'pako';
import { Log } from 'ng2-logger/browser';
import { gzip_decode } from 'wasm-flate';
import { StreamJSONInterface } from '@sports-alliance/sports-lib/streams/stream';

export class StreamEncoder {
  private static logger = Log.create('StreamEncoder');

  static compressStream(stream: StreamJSONInterface): CompressedJSONStreamInterface {
    const compressedStream: CompressedJSONStreamInterface = {
      encoding: CompressionEncodings.None,
      type: stream.type,
      data: JSON.stringify(stream.data),
      compressionMethod: CompressionMethods.None
    }
    this.logger.info(`[ORIGINAL] ${stream.type} = ${this.getSizeFormated(compressedStream.data)}`)
    // If we can fit it go on
    if (this.getSize(compressedStream.data) <= 1048487) {
      return compressedStream
    }
    // Then try Pako (as the fastest)
    compressedStream.data = Pako.gzip(JSON.stringify(stream.data), {to: 'string'});
    compressedStream.encoding = CompressionEncodings.Binary
    compressedStream.compressionMethod = CompressionMethods.Pako
    this.logger.info(`[COMPRESSED ${CompressionMethods.Pako}] ${stream.type} = ${this.getSizeFormated(compressedStream.data)}`)
    if (this.getSize(compressedStream.data) <= 1048487) {
      return compressedStream
    }
    // Then try with LZUTF8
    // compressedStream.data = LZUTF8.compress(JSON.stringify(stream.data), {
    //   outputEncoding: 'StorageBinaryString',
    // });
    // compressedStream.encoding = CompressionEncodings.Binary
    // compressedStream.compressionMethod = CompressionMethods.LZUTF8;
    // this.logger.info(`[COMPRESSED ${CompressionMethods.LZUTF8}] ${stream.type} = ${this.getSizeFormated(compressedStream.data)}`)
    // if (this.getSize(compressedStream.data) <= 1048487) {
    //   return compressedStream
    // }
    // Throw an error if smaller than a MB still
    throw new Error(`Cannot compress stream ${stream.type} its more than 1048487 bytes  ${this.getSize(compressedStream.data)}`)
  }

  static decompressStream(compressedStreamJSON: CompressedJSONStreamInterface): StreamJSONInterface {
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
        stream.data = compressedStreamJSON.encoding === CompressionEncodings.Binary
          ? gzip_decode(btoa(compressedStreamJSON.data))
          : gzip_decode(compressedStreamJSON.data)
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


  static getSize(obj: any): number {
    return <number>this.getSizeWithOptionalFormat(obj, false);
  }

  static getSizeFormated(obj: any): string {
    return <string>this.getSizeWithOptionalFormat(obj, true);
  }

  private static getSizeWithOptionalFormat(obj: any, format = true): string | number {
    const size = new Blob([obj]).size

    function formatByteSize(bytes: number): string {
      if (bytes < 1024) {
        return bytes + ' bytes';
      } else if (bytes < 1048576) {
        return (bytes / 1024).toFixed(4) + ' KiB';
      } else if (bytes < 1073741824) {
        return (bytes / 1048576).toFixed(4) + ' MiB';
      } else {
        return (bytes / 1073741824).toFixed(4) + ' GiB';
      }
    }

    return format ? formatByteSize(size) : size;
  }

  // private static async LZUTF8Result(data: any) {
  //   return new Promise((resolve, reject) => {
  //     LZUTF8.compressAsync(data, {outputEncoding: 'StorageBinaryString'}, (result, error) => {
  //       if (error) {
  //         reject(error);
  //         return;
  //       }
  //       resolve(result);
  //     })
  //   })
  //
  // }
}

export interface CompressedJSONStreamInterface {
  type: string
  data: any
  compressionMethod: CompressionMethods
  encoding: CompressionEncodings
}

export enum CompressionEncodings {
  None = 'None',
  Binary = 'Binary',
  base64 = 'base64',
}

export enum CompressionMethods {
  None = 'None',
  Binary = 'lz-string',
  Pako = 'Pako',
  // LZUTF8 = 'LZUTF8',
  // PakoThenLZUTF8 = 'PakoThenLZUTF8',
}
