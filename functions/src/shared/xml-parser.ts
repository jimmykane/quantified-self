import { DOMParser } from '@xmldom/xmldom';

/** Sports Lib's injectable parser boundary: never accept a repaired XML document
 * or print parser diagnostics that can contain private original-file content. */
export class XmlDOMParser {
  parseFromString(source: string, mimeType = 'application/xml'): Document {
    let invalid = false;
    const reject = () => { invalid = true; };
    try {
      const document = new DOMParser({
        errorHandler: { warning: reject, error: reject, fatalError: reject },
      }).parseFromString(source, mimeType);
      if (!invalid && document?.documentElement) {
        return document;
      }
    } catch {
      // Keep the original text and parser exception out of queue/log errors.
    }
    throw new Error('Invalid XML document');
  }
}
