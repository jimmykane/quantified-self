import { DestroyRef, Injectable, inject } from '@angular/core';
import { FirebaseAppCheckType, onTokenChanged } from 'app/firebase/app-check';
import { AppCheckFailureDetails, appCheckFailureDetails, isAppCheckVerificationFailure } from '../helpers/app-check-error.helper';
import { observeInitialAppCheckRejections } from '../helpers/app-check-console-diagnostics.helper';
import { LoggerService } from './logger.service';

type AuthState = 'restoring' | 'signed-in' | 'signed-out';
export type AppCheckOperation = 'profile-load' | 'callable';
/** Local ordering only; never copied into telemetry or request data. */
export interface AppCheckOperationAttempt {
  readonly authRevision: number;
  readonly sequence: number;
}
interface FailureEpisode {
  startedAt: number;
  details: AppCheckFailureDetails;
  authStateAtFailure: AuthState;
  observations: number;
}

@Injectable({ providedIn: 'root' })
export class AppCheckDiagnosticsService {
  private readonly logger = inject(LoggerService);
  private readonly destroyRef = inject(DestroyRef);
  private monitoredAppCheck: FirebaseAppCheckType | null = null;
  private observingLogs = false;
  private lastObservedToken: string | null = null;
  private readonly reportedFailures = new Set<string>();
  private authState: AuthState = 'restoring';
  private revision = 0;
  private operationSequence = 0;
  private episode: FailureEpisode | null = null;
  private readonly blockedOperations = new Map<AppCheckOperation, FailureEpisode & { scope?: string; recoveryAfterSequence: number }>();
  private readonly reportedOutcomes = new Set<string>();
  failureRevision = 0;

  beginOperation(): AppCheckOperationAttempt {
    return { authRevision: this.revision, sequence: ++this.operationSequence };
  }

  /** Fed by the existing Auth subscription; does not initialize Auth or request credentials. */
  setAuthState(state: 'signed-in' | 'signed-out'): void {
    if (state !== 'signed-in' && state !== 'signed-out') return;
    if (this.authState !== 'restoring') {
      this.episode = null;
      this.reportedFailures.clear();
    }
    this.blockedOperations.clear();
    this.authState = state;
    this.revision += 1;
  }

  observeInitialRejections(): void {
    if (this.observingLogs) return;
    this.observingLogs = true;
    const unsubscribe = observeInitialAppCheckRejections(details => this.reportDetails(details, 'console-breadcrumb'));
    this.destroyRef.onDestroy(unsubscribe);
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
        if (!result.token) return;
        if (result.token !== this.lastObservedToken) {
          if (this.episode) this.reportOutcome('token-available', this.episode, {
            // Observing a token does not prove that a protected operation succeeded.
            tokenChanged: this.lastObservedToken === null ? null : true,
          });
          this.episode = null;
          this.reportedFailures.clear();
        }
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

  reportOperationBlocked(error: unknown, operation: AppCheckOperation, attempt: AppCheckOperationAttempt, scope?: string): void {
    if (attempt.authRevision !== this.revision || !isAppCheckVerificationFailure(error)
      || (operation !== 'profile-load' && operation !== 'callable')) return;
    const pending = this.blockedOperations.get(operation);
    if (pending) {
      if (pending.scope === scope) {
        pending.observations = Math.min(1000, pending.observations + 1);
        pending.recoveryAfterSequence = this.operationSequence;
      }
      return;
    }
    const details = appCheckFailureDetails(error) ?? appCheckFailureDetails({ code: 'appCheck/unknown' })!;
    const episode = this.newEpisode(details);
    // Keep at most two pending operations. The callable name is local matching state, never telemetry.
    this.blockedOperations.set(operation, { ...episode, scope, recoveryAfterSequence: this.operationSequence });
    this.reportOutcome('operation-blocked', episode, { operation });
  }

  reportOperationSucceeded(operation: AppCheckOperation, attempt: AppCheckOperationAttempt, scope?: string): void {
    if (attempt.authRevision !== this.revision) return;
    const episode = this.blockedOperations.get(operation);
    // A request already in flight at the latest failure cannot establish subsequent recovery.
    if (!episode || episode.scope !== scope || attempt.sequence <= episode.recoveryAfterSequence) return;
    this.blockedOperations.delete(operation);
    this.reportOutcome('operation-succeeded', episode, { operation });
  }

  private newEpisode(details: AppCheckFailureDetails): FailureEpisode {
    return { startedAt: Date.now(), details, authStateAtFailure: this.authState, observations: 1 };
  }

  private episodeContext(episode: FailureEpisode): Record<string, unknown> {
    return {
      ...episode.details,
      authState: this.authState,
      authStateAtFailure: episode.authStateAtFailure,
      elapsedMs: Math.min(86_400_000, Math.max(0, Date.now() - episode.startedAt)),
      // Observer, console and request notifications can describe the same failed check.
      failureNotifications: episode.observations,
    };
  }

  private reportOutcome(
    outcome: 'token-available' | 'operation-blocked' | 'operation-succeeded',
    episode: FailureEpisode,
    extra: { operation?: AppCheckOperation; tokenChanged?: boolean | null },
  ): void {
    // Report each outcome/category once per Auth generation, with a page-wide budget.
    // Repeated episodes still update local recovery state without duplicating Sentry messages.
    const key = `${this.revision}:${outcome}:${extra.operation ?? 'verification'}`;
    if (this.reportedOutcomes.has(key) || this.reportedOutcomes.size >= 5) return;
    this.reportedOutcomes.add(key);
    try {
      this.logger.captureMessage('App Check verification outcome', {
        level: outcome === 'operation-blocked' ? 'warning' : 'info',
        fingerprint: ['app-check-outcome', outcome, extra.operation ?? 'verification', episode.details.code],
        tags: { appCheckOutcome: outcome, appCheckErrorCode: episode.details.code,
          appCheckAuthState: this.authState, ...(extra.operation ? { appCheckOperation: extra.operation } : {}) },
        contexts: { appCheck: { ...this.episodeContext(episode), outcome, ...extra } },
      });
    } catch { /* Observability must never affect verification or application operations. */ }
  }

  private reportDetails(details: AppCheckFailureDetails, source: 'console-breadcrumb' | 'token-observer' | 'token-request'): void {
    this.failureRevision += 1;
    if (this.episode) this.episode.observations = Math.min(1000, this.episode.observations + 1);
    else this.episode = this.newEpisode(details);
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
        tags: { appCheckPhase: phase, appCheckErrorCode: details.code, appCheckHttpStatus: String(details.httpStatus ?? 'unknown'),
          appCheckAuthState: this.authState },
        contexts: {
          appCheck: {
            ...this.episodeContext(this.episode), ...details, source,
            online: typeof navigator === 'undefined' ? null : navigator.onLine,
            visibility,
          },
        },
      });
    } catch { /* Diagnostics must never replace the verification failure. */ }
  }
}
