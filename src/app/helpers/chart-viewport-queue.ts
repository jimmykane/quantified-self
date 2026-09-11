import { BrowserCompatibilityService } from '../services/browser.compatibility.service';

interface PendingChart {
  element: HTMLElement;
  root: HTMLElement | null;
  resolve: (render: boolean) => void;
}

/** Prepare nearby plots one frame at a time, without hiding their Angular headers or controls. */
export class ChartViewportQueue {
  private readonly observers = new Map<HTMLElement | null, IntersectionObserver>();
  private readonly pending = new Set<PendingChart>();
  private readonly nearby = new Set<PendingChart>();
  private frame: number | null = null;

  wait(element: HTMLElement): { ready: Promise<boolean>; cancel: () => void } {
    if (!BrowserCompatibilityService.checkIntersectionObserverSupport()) {
      return { ready: Promise.resolve(true), cancel: () => undefined };
    }
    const root = scrollRoot(element);
    let observer = this.observers.get(root);
    try {
      if (!observer) observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          for (const job of this.pending) {
            if (job.element !== entry.target) continue;
            if (entry.isIntersecting) this.nearby.add(job);
            else this.nearby.delete(job);
          }
        }
        this.schedule();
      }, { root, rootMargin: '600px 0px' });
    } catch {
      return { ready: Promise.resolve(true), cancel: () => undefined };
    }
    this.observers.set(root, observer);
    let resolve: PendingChart['resolve'];
    const ready = new Promise<boolean>(done => { resolve = done; });
    const job: PendingChart = { element, root, resolve: resolve! };
    this.pending.add(job);
    try { observer.observe(element); } catch { this.finish(job, true); }
    return { ready, cancel: () => this.finish(job, false) };
  }

  private schedule(): void {
    if (this.frame !== null || !this.nearby.size) return;
    if (typeof requestAnimationFrame === 'undefined') {
      for (const job of [...this.nearby]) this.finish(job, true);
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const job = this.nearby.values().next().value as PendingChart | undefined;
      if (job) this.finish(job, true);
      this.schedule();
    });
  }

  private finish(job: PendingChart, render: boolean): void {
    if (!this.pending.delete(job)) return;
    this.nearby.delete(job);
    const observer = this.observers.get(job.root);
    if (![...this.pending].some(other => other.element === job.element)) observer?.unobserve(job.element);
    if (![...this.pending].some(other => other.root === job.root)) {
      observer?.disconnect();
      this.observers.delete(job.root);
    }
    job.resolve(render);
    if (this.pending.size) return;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}

function scrollRoot(element: HTMLElement): HTMLElement | null {
  // The app shell and bottom sheets scroll independently of the document. Using
  // their scrollport lets the preload margin reach beyond the currently visible plots.
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

export const chartViewportQueue = new ChartViewportQueue();
