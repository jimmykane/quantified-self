import { Injectable } from '@angular/core';
/** Browser features register bounded cleanup without creating an Auth/service dependency cycle. */
@Injectable({ providedIn: 'root' })
export class AuthSessionCleanupService {
  private readonly handlers = new Set<() => Promise<void>>();
  register(handler: () => Promise<void>): () => void {
    this.handlers.add(handler); return () => this.handlers.delete(handler);
  }
  async run(): Promise<void> {
    // Cleanup failure must never prevent sign-out or returning from impersonation.
    await Promise.allSettled([...this.handlers].map(handler => new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 2000);
      Promise.resolve().then(handler).catch(() => undefined).finally(() => { clearTimeout(timer); resolve(); });
    })));
  }
}
