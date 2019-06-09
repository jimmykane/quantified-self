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
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      });
    } catch (e) {
      this.logger.error(`Could not copy ${text}`);
      // Log to Sentry
      Sentry.captureException(e);
    }

  }
}
