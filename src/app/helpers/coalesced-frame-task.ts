/** Combines background updates before the next paint. The callback reads current state. */
export class CoalescedFrameTask {
  private cancelPending: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly task: () => void) {}

  request(): void {
    if (this.disposed || this.cancelPending) return;
    let active = true;
    let cancel = () => {};
    this.cancelPending = () => { active = false; cancel(); };
    const run = () => {
      if (!active) return;
      this.cancelPending = null;
      active = false;
      this.task();
    };
    if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
      const frame = requestAnimationFrame(run);
      cancel = () => cancelAnimationFrame(frame);
    } else {
      // SSR/older environments still coalesce without depending on browser APIs.
      const timer = setTimeout(run, 0);
      cancel = () => clearTimeout(timer);
    }
  }

  /** An immediate user action can absorb any queued background update. */
  cancel(): void {
    this.cancelPending?.();
    this.cancelPending = null;
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
  }
}
