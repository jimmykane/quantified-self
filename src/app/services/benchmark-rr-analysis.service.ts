import { Injectable, OnDestroy } from '@angular/core';
import type { RRAnalysis } from '@sports-alliance/sports-lib';
import type { BenchmarkRRAnalysisInput, BenchmarkRRWorkerResponse } from '../helpers/benchmark-rr.helper';
import { BrowserCompatibilityService } from './browser.compatibility.service';

/** Component-scoped worker: no parsed output is persisted or sent to a server. */
@Injectable()
export class BenchmarkRRAnalysisService implements OnDestroy {
  private worker: Worker | null = null;
  private pendingReject: ((error: Error) => void) | null = null;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  analyze(input: BenchmarkRRAnalysisInput): Promise<RRAnalysis | null> {
    this.cancel();
    return new Promise((resolve, reject) => {
      if (!BrowserCompatibilityService.checkWorkerSupport()) {
        reject(new Error('This browser cannot calculate R–R charts. Summary statistics remain available.'));
        return;
      }
      try {
        const worker = new Worker(new URL('../workers/benchmark-rr.worker', import.meta.url), { type: 'module' });
        this.worker = worker;
        this.pendingReject = reject;
        const finish = (response: BenchmarkRRWorkerResponse) => {
          if (worker !== this.worker) return;
          this.release();
          if ('error' in response) reject(new Error(response.error)); else resolve(response.analysis);
        };
        worker.onmessage = (event: MessageEvent<BenchmarkRRWorkerResponse>) => finish(event.data);
        worker.onerror = () => finish({ error: 'R–R chart calculation failed. Please try again.' });
        worker.onmessageerror = () => finish({ error: 'R–R chart calculation failed. Please try again.' });
        this.timeout = setTimeout(() => finish({ error: 'R–R chart calculation took too long. Please try again.' }), 30_000);
        worker.postMessage(input);
      } catch {
        this.release();
        reject(new Error('R–R charts could not be started. Summary statistics remain available.'));
      }
    });
  }

  cancel(): void {
    const reject = this.pendingReject;
    this.release();
    reject?.(new DOMException('R–R analysis was superseded.', 'AbortError'));
  }

  ngOnDestroy(): void { this.cancel(); }

  private release(): void {
    clearTimeout(this.timeout); this.timeout = undefined;
    this.pendingReject = null;
    this.worker?.terminate(); this.worker = null;
  }
}
