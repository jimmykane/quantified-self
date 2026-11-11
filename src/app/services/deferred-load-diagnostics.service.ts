import { Injectable, inject } from '@angular/core';
import { isDeferredLoadArea, type DeferredLoadArea } from '../helpers/deferred-load.helper';
import { LoggerService } from './logger.service';

@Injectable({ providedIn: 'root' })
export class DeferredLoadDiagnosticsService {
  private readonly logger = inject(LoggerService);
  private readonly reported = new Set<DeferredLoadArea>();

  report(area: DeferredLoadArea): void {
    if (!isDeferredLoadArea(area) || this.reported.has(area)) return;
    this.reported.add(area);
    try {
      // One warning per fixed area per app instance; no URLs, exception text or user content.
      this.logger.captureMessage('Deferred content failed to load', {
        level: 'warning', fingerprint: ['deferred-load', area], tags: { operation: 'deferred-load', area },
      });
    } catch { /* Diagnostics must never prevent recovery. */ }
  }
}
