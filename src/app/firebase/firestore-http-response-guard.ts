import { ErrorCode, XhrIo } from '@firebase/webchannel-wrapper/webchannel-blob';

let installed = false;

/**
 * Firebase's browser RPC callback parses HTTP error bodies without catching
 * SyntaxError. An empty/HTML gateway response escapes the callback and leaves
 * its promise pending, so application catchError handlers never run.
 *
 * Let the SDK use its existing non-JSON error fallback instead. Successful
 * responses and valid backend errors still use the original parser. Remove
 * this guard when upstream rejects malformed HTTP responses itself; the real
 * browser-SDK regression spec must also pass after an SDK upgrade.
 */
export function installFirestoreHttpResponseGuard(): void {
  if (installed) {
    return;
  }

  const parseResponse = XhrIo.prototype.getResponseJson;
  XhrIo.prototype.getResponseJson = function (this: XhrIo, ...args: Parameters<typeof parseResponse>) {
    try {
      return parseResponse.apply(this, args);
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError) || this.getLastErrorCode() !== ErrorCode.HTTP_ERROR) {
        throw error;
      }
      const status = this.getStatus();
      if (status >= 400 && status <= 599) {
        // An absent error object takes the SDK's normal "Server responded with
        // status ..." rejection path. Do not invent a successful response,
        // change retry policy, or log the response body here.
        return {};
      }
      throw error;
    }
  };
  installed = true;
}
