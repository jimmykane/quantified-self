import {Injectable, NgZone} from '@angular/core';
import {Log} from "ng2-logger/browser";
import * as Sentry from '@sentry/browser';


@Injectable()
export class ClipboardService {
  private logger = Log.create('ClipboardService');

  constructor(private zone: NgZone) {
  }

  public copyToClipboard(text: string) {
    try {
      this.zone.runOutsideAngular(() => {
        document.addEventListener('copy', (e: ClipboardEvent) => {
          e.clipboardData.setData('text/plain', (text));
          e.preventDefault();
          document.removeEventListener('copy', null);
        });
        document.execCommand('copy');
      });
    } catch (e) {
      this.logger.error(`Could not copy ${text}`);
      // Log to Sentry
      Sentry.captureException(e);
    }

  }
}
