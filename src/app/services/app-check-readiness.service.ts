import { Injectable, inject } from '@angular/core';
import { AppCheck, getToken as getAppCheckToken } from 'app/firebase/app-check';
import { AppCheckDiagnosticsService } from './app-check-diagnostics.service';

@Injectable({
  providedIn: 'root'
})
export class AppCheckReadinessService {
  private static readonly readinessTimeoutMs = 15_000;

  private appCheck = inject(AppCheck, { optional: true });
  private readonly diagnostics = inject(AppCheckDiagnosticsService);
  private readyPromise: Promise<void> | null = null;
  private readyRevision = 0;
  private readonly pendingTokens = new Map<boolean, Promise<string>>();

  isConfigured(): boolean {
    return !!this.appCheck;
  }

  async ensureReady(forceRefresh = false): Promise<void> {
    if (!this.appCheck) {
      return;
    }

    if (!forceRefresh && this.readyPromise && this.readyRevision === this.diagnostics.failureRevision) {
      await this.readyPromise;
      return;
    }

    const readinessPromise = this.fetchTokenWithinDeadline(forceRefresh).then(() => undefined);
    this.readyPromise = readinessPromise;
    this.readyRevision = this.diagnostics.failureRevision;

    try {
      await readinessPromise;
    } catch (error) {
      if (this.readyPromise === readinessPromise) {
        this.readyPromise = null;
      }
      throw error;
    }
  }

  async getToken(forceRefresh = false): Promise<string> {
    return this.fetchTokenWithinDeadline(forceRefresh);
  }

  private fetchTokenWithinDeadline(forceRefresh: boolean): Promise<string> {
    // Ordinary consumers may share a forced refresh, but a forced refresh must
    // not be satisfied by an older ordinary request. Never retain resolved tokens.
    const existing = this.pendingTokens.get(true) ?? (!forceRefresh ? this.pendingTokens.get(false) : undefined);
    if (existing) return existing;
    const request = this.fetchTokenWithDeadline(forceRefresh).finally(() => {
      if (this.pendingTokens.get(forceRefresh) === request) this.pendingTokens.delete(forceRefresh);
    });
    this.pendingTokens.set(forceRefresh, request);
    return request;
  }

  private async fetchTokenWithDeadline(forceRefresh: boolean): Promise<string> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tokenRequest = this.fetchToken(forceRefresh);
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(Object.assign(new Error('App Check is taking too long. Please reload the page to try again.'), {
          code: 'appCheck/token-timeout',
        }));
      }, AppCheckReadinessService.readinessTimeoutMs);
    });

    try {
      return await Promise.race([tokenRequest, deadline]);
    } catch (error) {
      try { this.diagnostics.reportFailure(error, 'token-request'); } catch { /* Preserve the actual verification result. */ }
      throw error;
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private async fetchToken(forceRefresh: boolean): Promise<string> {
    if (!this.appCheck) {
      throw new Error('App Check is not configured for this app.');
    }

    const appCheckResult = await getAppCheckToken(this.appCheck, forceRefresh);
    const appCheckToken = appCheckResult?.token;
    if (!appCheckToken) {
      throw new Error('Could not retrieve App Check token.');
    }

    return appCheckToken;
  }
}
