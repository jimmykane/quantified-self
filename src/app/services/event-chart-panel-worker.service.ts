import { Injectable, inject } from '@angular/core';
import { collectEventChartPanelBuildSnapshotTransferables } from '../helpers/event-echarts-data.helper';
import type {
  EventChartPanelBuildSnapshotInput,
  EventChartPanelModel,
  EventChartPanelWorkerRequest,
  EventChartPanelWorkerResponse,
} from '../helpers/event-echarts-data.helper';
import { LoggerService } from './logger.service';

type PendingPanelBuild = {
  resolve: (panels: EventChartPanelModel[]) => void;
  reject: (error: unknown) => void;
};

@Injectable({
  providedIn: 'root',
})
export class EventChartPanelWorkerService {
  private readonly logger = inject(LoggerService);

  private worker: Worker | null = null;
  private workerDisabled = false;
  private nextRequestID = 0;
  private readonly pendingRequests = new Map<number, PendingPanelBuild>();

  public shouldUseWorker(): boolean {
    return this.canUseWorker();
  }

  public buildPanels(
    input: EventChartPanelBuildSnapshotInput,
    fallbackBuilder: () => EventChartPanelModel[]
  ): Promise<EventChartPanelModel[]> {
    if (!this.canUseWorker()) {
      return Promise.resolve(fallbackBuilder());
    }

    try {
      return this.buildPanelsInWorker(input)
        .catch((error) => {
          this.disableWorker(error);
          return fallbackBuilder();
        });
    } catch (error) {
      this.disableWorker(error);
      return Promise.resolve(fallbackBuilder());
    }
  }

  private buildPanelsInWorker(input: EventChartPanelBuildSnapshotInput): Promise<EventChartPanelModel[]> {
    const worker = this.ensureWorker();
    const requestID = this.nextRequestID + 1;
    this.nextRequestID = requestID;

    return new Promise<EventChartPanelModel[]>((resolve, reject) => {
      this.pendingRequests.set(requestID, { resolve, reject });

      const request: EventChartPanelWorkerRequest = { requestID, input };
      try {
        worker.postMessage(request, collectEventChartPanelBuildSnapshotTransferables(input));
      } catch (error) {
        this.pendingRequests.delete(requestID);
        reject(error);
      }
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = new Worker(new URL('../workers/event-chart-panels.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<EventChartPanelWorkerResponse>) => this.handleWorkerMessage(event.data);
    worker.onerror = (event) => this.disableWorker(event.error || event.message || 'Event chart worker error');
    worker.onmessageerror = (event) => this.disableWorker(event.data || 'Event chart worker message error');
    this.worker = worker;
    return worker;
  }

  private handleWorkerMessage(response: EventChartPanelWorkerResponse | null | undefined): void {
    const requestID = Number(response?.requestID);
    if (!Number.isFinite(requestID)) {
      return;
    }

    const pending = this.pendingRequests.get(requestID);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(requestID);
    if ('error' in response) {
      pending.reject(new Error(response.error || 'Event chart worker failed to build panels'));
      return;
    }

    pending.resolve(response.panels || []);
  }

  private canUseWorker(): boolean {
    return !this.workerDisabled && typeof Worker !== 'undefined';
  }

  private disableWorker(error: unknown): void {
    if (!this.workerDisabled) {
      this.workerDisabled = true;
      this.logger.warn('[EventChartPanelWorker] Falling back to synchronous panel builds after worker failure', error);
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.rejectAllPending(error);
  }

  private rejectAllPending(error: unknown): void {
    const pendingRequests = [...this.pendingRequests.values()];
    this.pendingRequests.clear();
    pendingRequests.forEach((pending) => pending.reject(error));
  }
}
