import { ServiceNames } from '@sports-alliance/sports-lib';
import { historyRangeLabel, historyRangeOptions, type ConnectionHistoryStatus, type HistoryResource } from '@shared/connection-history';
import { getProviderDisplayName } from '@shared/provider-presentation';
import { SERVICE_CONNECTION_STATES, type ServiceConnectionState } from '@shared/service-connection';

export const HISTORY_IMPORT_PROVIDERS = [ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI] as const;
export const HISTORY_IMPORT_RECENT_MS = 24 * 60 * 60 * 1000;
export type HistoryImportKind = 'active' | 'retrying' | 'attention' | 'requested' | 'processed' | 'unavailable';
export interface HistoryImportSource {
  serviceName: ServiceNames; projection?: unknown; unavailable?: boolean;
  /** The metadata reader supplies null after the server clears a connection. */
  connectionState?: ServiceConnectionState | null;
}
export interface HistoryImportProgressStep {
  id: string; label: string; description: string; icon: string; status: ConnectionHistoryStatus;
  count: number | null; countLabel: string; message: string | null;
}
export interface HistoryImportProgressItem {
  serviceName: ServiceNames; name: string; runId: string | null; kind: HistoryImportKind; label: string;
  rangeLabel: string | null; steps: HistoryImportProgressStep[]; expiresAtMs?: number; explanation?: string;
  updatedAtMs?: number; canDismiss?: boolean; requestOnly?: boolean;
}
export interface HistoryImportResultDismissal {
  serviceName: ServiceNames; runId: string; updatedAtMs: number;
}
export interface HistoryImportProgressView {
  items: HistoryImportProgressItem[]; active: boolean; label: string; nextExpiryAtMs: number | null;
}
const resourceNames: Record<HistoryResource, string> = {activities: 'Activities', sleep: 'Sleep', health: 'Health', routes: 'Saved routes'};
const descriptions: Record<ConnectionHistoryStatus, string> = {
  queued: 'Queued', requesting: 'Requesting history', retrying: 'Waiting to retry',
  requested: 'Requested; delivery may take hours or days', processed: 'Processed', skipped: 'Skipped', failed: 'Failed',
};
const icons: Record<ConnectionHistoryStatus, string> = {
  queued: 'schedule', requesting: 'sync', retrying: 'update', requested: 'schedule',
  processed: 'check_circle', skipped: 'info', failed: 'warning',
};
const labels: Record<HistoryImportKind, string> = {
  active: 'Importing', retrying: 'Waiting to retry', attention: 'Finished with issues',
  requested: 'History requested', processed: 'Processed', unavailable: 'Status unavailable',
};
const requestLabels: Record<HistoryImportKind, string> = {...labels,
  active: 'Requesting history', retrying: 'Waiting to retry requests', processed: 'Request processing finished'};
const order: Record<HistoryImportKind, number> = {active: 0, retrying: 1, attention: 2, unavailable: 3, requested: 4, processed: 5};
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validTime(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && !Number.isNaN(new Date(value).getTime()); }
function unavailable(serviceName: ServiceNames): HistoryImportProgressItem {
  return {serviceName, name: getProviderDisplayName(serviceName), runId: null, kind: 'unavailable',
    label: labels.unavailable, rangeLabel: null, steps: []};
}
function item(source: HistoryImportSource): HistoryImportProgressItem | null {
  const {serviceName, projection: value} = source;
  const requestOnly = serviceName === ServiceNames.GarminAPI;
  if (source.unavailable) return unavailable(serviceName);
  // Disconnect rotates the lifecycle but can retain the last run projection.
  // Do not present that stale run as work that is still being performed.
  if (source.connectionState === null || source.connectionState === SERVICE_CONNECTION_STATES.DisconnectPending) return null;
  if (value === undefined || value === null) return null;
  if (!record(value) || typeof value.runId !== 'string' || !value.runId.trim() || value.runId.length > 256
    || typeof value.active !== 'boolean' || !validTime(value.updatedAtMs)
    || !Array.isArray(value.steps) || !value.steps.length || value.steps.length > 32) return unavailable(serviceName);
  const steps: HistoryImportProgressStep[] = [];
  for (const step of value.steps) {
    if (!record(step) || typeof step.id !== 'string' || !step.id || typeof step.status !== 'string'
      || !Object.hasOwn(descriptions, step.status) || !Array.isArray(step.resources) || !step.resources.length
      || step.resources.some(resource => typeof resource !== 'string' || !Object.hasOwn(resourceNames, resource))) return unavailable(serviceName);
    const status = step.status as ConnectionHistoryStatus;
    const count = typeof step.count === 'number' && Number.isSafeInteger(step.count) && step.count >= 0 ? step.count : null;
    steps.push({id: step.id, label: [...new Set(step.resources as HistoryResource[])].map(resource => resourceNames[resource]).join(' & '),
      status, description: requestOnly && status === 'processed' ? requestLabels.processed : descriptions[status], icon: icons[status],
      count, countLabel: requestOnly ? count === 1 ? 'request scheduled' : 'requests scheduled' : 'items or requests',
      message: typeof step.message === 'string' && step.message.trim() ? step.message.slice(0, 1000) : null});
  }
  if (!value.active && steps.some(step => step.status === 'queued' || step.status === 'requesting' || step.status === 'retrying')) return unavailable(serviceName);
  const kind: HistoryImportKind = value.active
    ? steps.some(step => step.status === 'retrying') && !steps.some(step => step.status === 'queued' || step.status === 'requesting') ? 'retrying' : 'active'
    : steps.some(step => step.status === 'failed' || step.status === 'skipped') ? 'attention'
      : steps.some(step => step.status === 'requested') ? 'requested' : 'processed';
  // A submitted provider request is not a live delivery tracker. Keep recent terminal
  // outcomes for context, without an indefinite activity spinner or delivery claim.
  const expiresAtMs = kind === 'requested' || kind === 'processed' ? value.updatedAtMs + HISTORY_IMPORT_RECENT_MS : undefined;
  const range = typeof value.rangePreset === 'string' && (value.rangePreset === 'custom'
    || historyRangeOptions(serviceName).some(option => option.value === value.rangePreset))
    ? historyRangeLabel(serviceName, value.rangePreset as Parameters<typeof historyRangeLabel>[1]) : null;
  if (value.active && source.connectionState === SERVICE_CONNECTION_STATES.ReconnectRequired) {
    return {serviceName, name: getProviderDisplayName(serviceName), runId: value.runId, kind: 'attention',
      label: 'Reconnect required', rangeLabel: range, steps: [],
      explanation: 'This connection needs authorization. Open Connections to review and reconnect the provider before importing more history.'};
  }
  return {serviceName, name: getProviderDisplayName(serviceName), runId: value.runId, kind,
    label: (requestOnly ? requestLabels : labels)[kind], requestOnly,
    rangeLabel: range, steps, expiresAtMs, updatedAtMs: value.updatedAtMs, canDismiss: !value.active && kind === 'attention'};
}
/** Latest persisted statuses for Connections, independent of notification dismissal and age. */
export function buildHistoryImportItems(sources: readonly HistoryImportSource[]): HistoryImportProgressItem[] {
  return sources.map(source => item(source)).filter((entry): entry is HistoryImportProgressItem => !!entry)
    .sort((a, b) => order[a.kind] - order[b.kind]);
}
export function buildHistoryImportProgress(sources: readonly HistoryImportSource[], nowMs: number,
  dismissed: readonly HistoryImportResultDismissal[] = []): HistoryImportProgressView {
  const items = buildHistoryImportItems(sources)
    .filter(entry => entry.expiresAtMs === undefined || entry.expiresAtMs > nowMs)
    .filter(entry => !entry.canDismiss || !dismissed.some(result => result.serviceName === entry.serviceName
      && result.runId === entry.runId && result.updatedAtMs === entry.updatedAtMs));
  const active = items.some(entry => entry.kind === 'active' || entry.kind === 'retrying');
  const requestItem = items.length === 1 && items[0].requestOnly ? items[0] : null;
  const label = requestItem?.kind === 'active' ? 'Requesting Garmin history'
    : requestItem?.kind === 'retrying' ? 'Waiting to retry Garmin requests'
    : requestItem?.kind === 'processed' ? 'History requests finished'
    : active ? 'Importing history' : items.some(entry => entry.kind === 'attention' && !entry.canDismiss) ? 'History needs attention'
    : items.some(entry => entry.kind === 'unavailable') ? 'Import status unavailable'
      : items.some(entry => entry.kind === 'attention') ? 'History finished with issues'
      : items.some(entry => entry.kind === 'requested') ? 'History requested' : 'History processed';
  const deadlines = items.flatMap(entry => entry.expiresAtMs === undefined ? [] : [entry.expiresAtMs]);
  return {items, active, label, nextExpiryAtMs: deadlines.length ? Math.min(...deadlines) : null};
}
