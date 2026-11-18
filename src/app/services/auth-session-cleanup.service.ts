import { Injectable } from '@angular/core';
export type SessionCleanupReason = 'signed_out' | 'account_switch' | 'custom_token_sign_in';
/** Browser features register bounded cleanup without creating an Auth/service dependency cycle. */
@Injectable({ providedIn: 'root' })
export class AuthSessionCleanupService {
  private readonly handlers = new Set<(reason: SessionCleanupReason) => Promise<void>>();
  register(handler: (reason: SessionCleanupReason) => Promise<void>): () => void {
    this.handlers.add(handler); return () => this.handlers.delete(handler);
  }
  async run(reason: SessionCleanupReason): Promise<void> {
    // Cleanup failure must never prevent sign-out or returning from impersonation.
    await Promise.allSettled([...this.handlers].map(handler => new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 2000);
      Promise.resolve().then(() => handler(reason)).catch(() => undefined).finally(() => { clearTimeout(timer); resolve(); });
    })));
  }
}
