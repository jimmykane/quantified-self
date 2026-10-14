import { ServiceNames } from '@sports-alliance/sports-lib';

export const ACTIVITY_SEND_PROVIDERS = {
  suunto: ServiceNames.SuuntoApp,
  coros: ServiceNames.COROSAPI,
  wahoo: ServiceNames.WahooAPI,
} as const;
export type ActivitySendProvider = keyof typeof ACTIVITY_SEND_PROVIDERS;
export const ACTIVITY_SEND_LIMITS = { fileBytes: 20 * 1024 * 1024, userBytes: 200 * 1024 * 1024, files: 50, page: 50 } as const;
export type ActivitySendStatus = 'preparing' | 'ready' | 'queued' | 'sending' | 'processing' | 'delivered' | 'duplicate' | 'needs_action' | 'stopped';
export type ActivitySendRecovery = 'none' | 'choose_file' | 'reconnect' | 'check_status' | 'retry_send' | 'review_provider' | 'upgrade';
export interface ActivitySendRow {
  id: string;
  name: string;
  sport: string | null;
  startDate: number | null;
  size: number;
  warnings: string[];
  status: ActivitySendStatus;
  recovery: ActivitySendRecovery;
  message: string;
  attempts: number;
}
export interface ActivitySendBatch {
  id: string;
  provider: ActivitySendProvider;
  source: 'files' | 'saved';
  state: 'draft' | 'confirmed' | 'complete';
  revision: number;
  accountLabel: string;
  createdAt: number;
  updatedAt: number;
  reviewed: boolean;
  total: number;
  finished: number;
}
export type ActivitySendCommand = {
  version: 1;
  batchId: string;
} & (
  | { action: 'create'; provider: ActivitySendProvider; source: 'files' | 'saved' }
  | { action: 'prepare'; eventIds?: string[]; startDate?: string; endDate?: string; sources?: string[]; cursor?: string }
  | { action: 'confirm'; revision: number }
  | { action: 'stop' }
  | { action: 'remove' | 'check' | 'retry'; rowId: string }
);
export interface ActivitySendCommandResult { batchId: string; revision: number; nextCursor?: string | null }
export function isActivitySendProvider(value: unknown): value is ActivitySendProvider {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITY_SEND_PROVIDERS, value);
}
export function activitySendTerminal(status: ActivitySendStatus): boolean {
  return ['delivered', 'duplicate', 'needs_action', 'stopped'].includes(status);
}
