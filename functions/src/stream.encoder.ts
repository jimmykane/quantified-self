import * as Pako from 'pako';
import { StreamJSONInterface } from '@sports-alliance/sports-lib/lib/streams/stream';

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
    console.info(`[ORIGINAL] ${stream.type} = ${this.getSizeFormated(compressedStream.data)}`)
    // If we can fit it go on
    if (this.getSize(compressedStream.data) <= 1048487) {
      return compressedStream
    }
    // Then try Pako (as the fastest)
    compressedStream.data = Pako.gzip(JSON.stringify(stream.data), {to: 'string'});
    compressedStream.encoding = CompressionEncodings.Binary
    compressedStream.compressionMethod = CompressionMethods.Pako
    console.info(`[COMPRESSED ${CompressionMethods.Pako}] ${stream.type} = ${this.getSizeFormated(compressedStream.data)}`)
    if (this.getSize(compressedStream.data) <= 1048487) {
      return compressedStream
    }
    throw new Error(`Cannot compress stream ${stream.type} its more than 1048487 bytes  ${this.getSize(compressedStream.data)}`)
  }

  static getSize(obj: any): number {
    return <number>this.getSizeWithOptionalFormat(obj, false);
  }

  static getSizeFormated(obj: any): string {
    return <string>this.getSizeWithOptionalFormat(obj, true);
  }

  private static getSizeWithOptionalFormat(obj: any, format = true): string | number {
    const size = Buffer.from(obj).length
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
