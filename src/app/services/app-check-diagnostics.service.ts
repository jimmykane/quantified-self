import { DestroyRef, Injectable, inject } from '@angular/core';
import { onLog } from 'firebase/app';
import { FirebaseAppCheckType, onTokenChanged } from 'app/firebase/app-check';
import { AppCheckFailureDetails, appCheckFailureDetails, initialAppCheckRejectionFromLog } from '../helpers/app-check-error.helper';
import { LoggerService } from './logger.service';

@Injectable({ providedIn: 'root' })
export class AppCheckDiagnosticsService {
  private readonly logger = inject(LoggerService);
  private readonly destroyRef = inject(DestroyRef);
  private monitoredAppCheck: FirebaseAppCheckType | null = null;
  private observingLogs = false;
  private lastObservedToken: string | null = null;
  private readonly reportedFailures = new Set<string>();
  failureRevision = 0;

  observeInitialRejections(): void {
    if (this.observingLogs) return;
    this.observingLogs = true;
    // This is the app's sole Firebase user log callback. Console logging and SDK
    // log levels stay unchanged; other Firebase services and arbitrary args are ignored.
    onLog(entry => {
      if (entry.type !== '@firebase/app-check' || entry.level !== 'warn') return;
      const details = initialAppCheckRejectionFromLog(entry.message);
      if (details) this.reportDetails(details, 'sdk-log');
    }, { level: 'warn' });
    this.destroyRef.onDestroy(() => onLog(null));
  }

  monitor(appCheck: FirebaseAppCheckType): void {
    if (this.monitoredAppCheck === appCheck) return;
    this.monitoredAppCheck = appCheck;
    // Register during App Check initialization, before Auth/Firestore consumers can lose
    // the initial rejection among subsequent throttling/permission errors.
    const unsubscribe = onTokenChanged(appCheck,
      result => {
        // A cached token notification after a failed refresh is not a recovery.
        // Compare only in memory; token values never enter a diagnostic or storage.
        if (result.token !== this.lastObservedToken) this.reportedFailures.clear();
        this.lastObservedToken = result.token;
      },
      error => this.reportFailure(error, 'token-observer'));
    this.destroyRef.onDestroy(unsubscribe);
  }

  reportFailure(error: unknown, source: 'token-observer' | 'token-request'): void {
    const details = appCheckFailureDetails(error);
    if (!details) return;
    this.reportDetails(details, source);
  }

  private reportDetails(details: AppCheckFailureDetails, source: 'sdk-log' | 'token-observer' | 'token-request'): void {
    this.failureRevision += 1;
    // One report per failure kind until a verified token arrives. A cooldown following
    // an initial rejection is the same incident, even across many concurrent consumers.
    const key = details.cooldown ? `cooldown:${details.httpStatus}` : `${details.code}:${details.httpStatus}`;
    if (this.reportedFailures.has(key)) return;
    this.reportedFailures.add(key);
    const phase = details.code === 'appCheck/initial-throttle' ? 'initial-rejection'
      : details.cooldown ? 'cooldown' : 'verification';
    const visibility = typeof document === 'undefined' ? 'unknown'
      : document.visibilityState === 'visible' ? 'visible' : document.visibilityState === 'hidden' ? 'hidden' : 'unknown';
    try {
      this.logger.captureMessage('App Check verification failed', {
        level: 'warning',
        fingerprint: ['app-check-verification', phase, String(details.httpStatus ?? 'unknown')],
        tags: { appCheckPhase: phase, appCheckErrorCode: details.code, appCheckHttpStatus: String(details.httpStatus ?? 'unknown') },
        contexts: {
          appCheck: {
            ...details, source,
            online: typeof navigator === 'undefined' ? null : navigator.onLine,
            visibility,
          },
        },
      });
    } catch { /* Diagnostics must never replace the verification failure. */ }
  }
}
