import { Injectable, inject } from '@angular/core';
import { AppCheck, getToken as getAppCheckToken } from 'app/firebase/app-check';

@Injectable({
  providedIn: 'root'
})
export class AppCheckReadinessService {
  private appCheck = inject(AppCheck, { optional: true });
  private readyPromise: Promise<void> | null = null;

  isConfigured(): boolean {
    return !!this.appCheck;
  }

  async ensureReady(forceRefresh = false): Promise<void> {
    if (!this.appCheck) {
      return;
    }

    if (!forceRefresh && this.readyPromise) {
      await this.readyPromise;
      return;
    }

    const readinessPromise = this.fetchToken(forceRefresh).then(() => undefined);
    this.readyPromise = readinessPromise;

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
    return this.fetchToken(forceRefresh);
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
