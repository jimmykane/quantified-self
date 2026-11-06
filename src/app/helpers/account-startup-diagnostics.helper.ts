import { appCheckFailureDetails } from './app-check-error.helper';

export const PROFILE_DOCUMENTS = ['user', 'legal', 'system', 'settings'] as const;
export type ProfileDocumentKind = typeof PROFILE_DOCUMENTS[number];
export type AccountStartupStage = 'auth-token' | 'browser-verification' | 'profile-listener'
  | 'profile-merge' | 'profile-verification' | 'token-claims';
export interface StartupStageAttempt {
  readonly stage: AccountStartupStage;
  readonly startedAt: number;
}

/** Local handles contain no account data; only fixed labels and bounded timings leave this recorder. */
export class AccountStartupDiagnostics {
  private readonly active = new Map<AccountStartupStage, StartupStageAttempt>();
  private readonly pendingDocuments = new Set<ProfileDocumentKind>();
  private readonly completedMs: Partial<Record<AccountStartupStage, number>> = {};
  private readonly reportedStages = new Set<AccountStartupStage>();
  private startedAt: number;
  private lastFailedStage: AccountStartupStage | null = null;
  private recovered = false;
  private reportCount = 0;

  constructor(
    private readonly capture: (message: string, context: Record<string, unknown>) => void,
    private readonly now: () => number = () => Date.now(),
  ) { this.startedAt = now(); }

  reset(): void {
    this.active.clear();
    this.pendingDocuments.clear();
    for (const stage of Object.keys(this.completedMs)) delete this.completedMs[stage];
    this.reportedStages.clear();
    this.lastFailedStage = null;
    this.recovered = false;
    this.startedAt = this.now();
    // Keep the page-wide report budget across account changes and manual retries.
  }

  begin(stage: AccountStartupStage): StartupStageAttempt {
    const attempt = { stage, startedAt: this.now() };
    this.active.set(stage, attempt);
    if (stage === 'profile-listener') {
      this.pendingDocuments.clear();
      PROFILE_DOCUMENTS.forEach(kind => this.pendingDocuments.add(kind));
    }
    return attempt;
  }

  documentReady(attempt: StartupStageAttempt, kind: ProfileDocumentKind): void {
    if (this.active.get('profile-listener') === attempt) this.pendingDocuments.delete(kind);
  }

  complete(attempt: StartupStageAttempt): void {
    if (this.active.get(attempt.stage) !== attempt) return;
    this.completedMs[attempt.stage] = this.elapsed(attempt.startedAt);
    this.cancel(attempt);
  }

  cancel(attempt: StartupStageAttempt): void {
    if (this.active.get(attempt.stage) !== attempt) return;
    this.active.delete(attempt.stage);
    if (attempt.stage === 'profile-listener') this.pendingDocuments.clear();
  }

  failed(attempt: StartupStageAttempt, error: unknown): void {
    if (this.active.get(attempt.stage) !== attempt) return;
    const stage = attempt.stage === 'profile-listener' && this.pendingDocuments.size === 0
      ? 'profile-merge' : attempt.stage;
    this.lastFailedStage = stage;
    if (this.reportedStages.has(stage)) return;
    this.reportedStages.add(stage);
    const code = safeStartupErrorCode(error);
    this.report('Account startup stage failed', {
      level: 'warning', fingerprint: ['account-startup', stage, code],
      tags: { startup_stage: stage, startup_error_code: code },
      contexts: { accountStartup: { ...this.snapshot(), stageElapsedMs: this.elapsed(attempt.startedAt) } },
    });
  }

  ready(): void {
    if (this.lastFailedStage === null || this.recovered) return;
    this.recovered = true;
    this.report('Account startup recovered', {
      level: 'info', fingerprint: ['account-startup', 'recovered'],
      tags: { startup_stage: this.lastFailedStage },
      contexts: { accountStartup: this.snapshot() },
    });
  }

  snapshot() {
    return {
      elapsedMs: this.elapsed(this.startedAt),
      activeStages: [...this.active.keys()],
      activeStageElapsedMs: Object.fromEntries([...this.active].map(([stage, attempt]) => [stage, this.elapsed(attempt.startedAt)])),
      completedStageMs: { ...this.completedMs },
      pendingProfileDocuments: PROFILE_DOCUMENTS.filter(kind => this.pendingDocuments.has(kind)),
      lastFailedStage: this.lastFailedStage,
    };
  }

  private elapsed(startedAt: number): number { return Math.min(86_400_000, Math.max(0, this.now() - startedAt)); }

  private report(message: string, context: Record<string, unknown>): void {
    if (this.reportCount >= 8) return;
    this.reportCount += 1;
    try { this.capture(message, context); } catch { /* Reporting never gates account loading. */ }
  }
}

function safeStartupErrorCode(error: unknown): string {
  const appCheck = appCheckFailureDetails(error);
  if (appCheck) return appCheck.code;
  const code = (error as { code?: unknown } | null)?.code;
  return ['deadline-exceeded', 'permission-denied', 'unauthenticated', 'unavailable', 'aborted',
    'firestore/deadline-exceeded', 'firestore/permission-denied', 'firestore/unauthenticated',
    'firestore/unavailable', 'firestore/aborted', 'auth/network-request-failed',
    'auth/user-token-expired', 'auth/invalid-user-token', 'account/settings-load-failed', 'account/profile-read-timeout'].find(value => value === code) ?? 'unknown';
}
