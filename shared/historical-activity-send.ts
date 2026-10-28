import { ServiceNames } from '@sports-alliance/sports-lib';
import { ActivityDeliverySource } from './activity-sync-routes';

export interface HistoricalSendCursor {
  lastStartDate: number;
  lastEventID: string;
  queryHash: string;
}

export interface HistoricalSendRequest {
  version: 2;
  action: 'preview' | 'send';
  destinationServiceName: ServiceNames;
  sources: ActivityDeliverySource[];
  startDate: string;
  endDate: string;
  cursor?: HistoricalSendCursor;
}

export interface HistoricalSendResponse {
  scanned: number;
  eligibleBySource: Record<string, number>;
  skippedBySource: Record<string, number>;
  queued: number;
  skippedByReason: Record<string, number>;
  failedCount: number;
  nextCursor: HistoricalSendCursor | null;
}
