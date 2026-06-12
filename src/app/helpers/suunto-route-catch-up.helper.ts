import {
  DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID,
  DashboardActionPromptViewModel,
} from './dashboard-action-prompt.helper';

export const SUUNTO_ROUTE_CATCH_UP_PROMPT_SOURCE = 'suunto-route-catch-up';

export interface SuuntoRouteCatchUpSummaryLike {
  queuedCount: number;
  skippedCount: number;
  failureCount: number;
  failedProviderCount?: number;
  totalCount: number;
}

export interface SuuntoRouteCatchUpSnackbarMessage {
  message: string;
  duration: number;
}

export type SuuntoRouteCatchUpPromptVariant = 'upgrade' | 'reconnect' | 'queue';

interface SuuntoRouteImportProviderStateLike {
  didLastRouteImport?: unknown;
}

interface SuuntoRouteImportMetaLike {
  didLastRouteImport?: unknown;
  routeImportStatesByProviderUserId?: unknown;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof (value as { toDate?: unknown } | null)?.toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (
    typeof (value as { seconds?: unknown } | null)?.seconds === 'number'
    && typeof (value as { nanoseconds?: unknown } | null)?.nanoseconds === 'number'
  ) {
    const timestamp = value as { seconds: number; nanoseconds: number };
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000);
  }
  return null;
}

function buildServiceTokenFingerprint(serviceToken: unknown): string | null {
  if (!serviceToken || typeof serviceToken !== 'object') {
    return null;
  }

  const token = serviceToken as { dateCreated?: unknown; userName?: unknown };
  const createdAt = toDate(token.dateCreated)?.getTime() ?? 'unknown-created';
  const userName = typeof token.userName === 'string' && token.userName.trim().length > 0
    ? token.userName.trim()
    : 'unknown-user';

  return `${userName}:${createdAt}`;
}

function getProviderUserIdFromServiceToken(serviceToken: unknown): string | null {
  if (!serviceToken || typeof serviceToken !== 'object') {
    return null;
  }

  const userName = (serviceToken as { userName?: unknown }).userName;
  return typeof userName === 'string' && userName.trim().length > 0
    ? userName.trim()
    : null;
}

function getStableServiceTokenSourceKey(serviceTokens: unknown): string | null {
  if (!Array.isArray(serviceTokens) || serviceTokens.length === 0) {
    return null;
  }

  const fingerprints = serviceTokens
    .map(token => buildServiceTokenFingerprint(token))
    .filter((fingerprint): fingerprint is string => !!fingerprint)
    .sort((left, right) => left.localeCompare(right));

  return fingerprints.length > 0 ? fingerprints.join('|') : null;
}

function getSuuntoRouteImportStatesByProviderUserId(
  serviceMeta: SuuntoRouteImportMetaLike | null | undefined,
): Record<string, SuuntoRouteImportProviderStateLike> {
  const rawStates = serviceMeta?.routeImportStatesByProviderUserId;
  if (!rawStates || typeof rawStates !== 'object' || Array.isArray(rawStates)) {
    return {};
  }

  return Object.entries(rawStates as Record<string, unknown>).reduce<Record<string, SuuntoRouteImportProviderStateLike>>((result, [providerUserId, rawState]) => {
    if (typeof providerUserId !== 'string' || providerUserId.trim().length === 0) {
      return result;
    }
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
      return result;
    }

    result[providerUserId.trim()] = rawState as SuuntoRouteImportProviderStateLike;
    return result;
  }, {});
}

export function getSuuntoRouteCatchUpDate(value: unknown): Date | null {
  return toDate(value);
}

export function getSuuntoConnectedProviderUserIds(serviceTokens: unknown): string[] {
  if (!Array.isArray(serviceTokens) || serviceTokens.length === 0) {
    return [];
  }

  return Array.from(new Set(
    serviceTokens
      .map(token => getProviderUserIdFromServiceToken(token))
      .filter((providerUserId): providerUserId is string => providerUserId !== null),
  )).sort((left, right) => left.localeCompare(right));
}

export function getSuuntoRouteCatchUpDateForConnectedProviders(
  serviceMeta: SuuntoRouteImportMetaLike | null | undefined,
  serviceTokens: unknown,
): Date | null {
  const connectedProviderUserIds = getSuuntoConnectedProviderUserIds(serviceTokens);
  const providerStates = getSuuntoRouteImportStatesByProviderUserId(serviceMeta);

  if (connectedProviderUserIds.length === 0 || Object.keys(providerStates).length === 0) {
    return getSuuntoRouteCatchUpDate(serviceMeta?.didLastRouteImport);
  }

  const connectedDates = connectedProviderUserIds.map(providerUserId => (
    getSuuntoRouteCatchUpDate(providerStates[providerUserId]?.didLastRouteImport)
  ));

  if (connectedDates.some(date => date === null)) {
    return null;
  }

  const latestTimestamp = Math.max(...connectedDates.map(date => (date as Date).getTime()));
  return new Date(latestTimestamp);
}

export function getSuuntoRouteCatchUpCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function buildSuuntoRouteCatchUpSnackbarMessage(
  summary: SuuntoRouteCatchUpSummaryLike,
): SuuntoRouteCatchUpSnackbarMessage {
  const failedProviderCount = getSuuntoRouteCatchUpCount(summary.failedProviderCount);

  if (summary.totalCount === 0 && failedProviderCount === 0) {
    return {
      message: 'No Suunto routes were found to queue.',
      duration: 3500,
    };
  }

  const messageParts = summary.totalCount === 0
    ? ['No Suunto routes were found to queue.']
    : [`Queued ${summary.queuedCount} ${summary.queuedCount === 1 ? 'route' : 'routes'}.`];
  if (summary.skippedCount > 0) {
    messageParts.push(`Skipped ${summary.skippedCount}.`);
  }
  if (summary.failureCount > 0) {
    messageParts.push(`Failed ${summary.failureCount}.`);
  }
  if (failedProviderCount > 0) {
    messageParts.push(`Failed ${failedProviderCount} connected ${failedProviderCount === 1 ? 'account' : 'accounts'}.`);
  }

  return {
    message: messageParts.join(' '),
    duration: summary.failureCount > 0 || failedProviderCount > 0 ? 4500 : 3500,
  };
}

export function buildSuuntoRouteCatchUpPromptSource(options: {
  connected: boolean;
  reconnectRequired: boolean;
  reconnectPromptSource?: string | null;
  serviceTokens?: unknown;
}): string | null {
  if (options.reconnectRequired) {
    return `${SUUNTO_ROUTE_CATCH_UP_PROMPT_SOURCE}:${options.reconnectPromptSource || 'reconnect'}`;
  }

  if (!options.connected) {
    return null;
  }

  const tokenSourceKey = getStableServiceTokenSourceKey(options.serviceTokens);
  return `${SUUNTO_ROUTE_CATCH_UP_PROMPT_SOURCE}:connected:${tokenSourceKey ?? 'unknown'}`;
}

export function buildSuuntoRouteCatchUpPromptViewModel(options: {
  variant: SuuntoRouteCatchUpPromptVariant;
  busy: boolean;
  error: string | null;
}): DashboardActionPromptViewModel {
  switch (options.variant) {
    case 'upgrade':
      return {
        id: DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID,
        icon: 'route',
        title: 'Import existing Suunto routes',
        description: 'Older Suunto routes need one manual catch-up. Upgrade to Pro to queue your current Suunto route library.',
        busy: options.busy,
        error: options.error,
        primaryAction: {
          id: 'upgradeToPro',
          label: 'Upgrade to Pro',
          icon: 'workspace_premium',
        },
        secondaryAction: {
          id: 'dismissSuuntoRouteCatchUp',
          label: 'Not now',
        },
      };
    case 'reconnect':
      return {
        id: DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID,
        icon: 'sync_problem',
        title: 'Import existing Suunto routes',
        description: 'Older Suunto routes need one manual catch-up. Reconnect Suunto before queueing your current route library.',
        busy: options.busy,
        error: options.error,
        primaryAction: {
          id: 'reconnectSuuntoService',
          label: 'Reconnect',
          icon: 'sync',
          loadingLabel: 'Redirecting...',
        },
        secondaryAction: {
          id: 'dismissSuuntoRouteCatchUp',
          label: 'Not now',
        },
      };
    default:
      return {
        id: DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID,
        icon: 'route',
        title: 'Import existing Suunto routes',
        description: 'New and updated Suunto routes already import automatically while connected. Queue one manual catch-up to pull older routes already stored in Suunto.',
        busy: options.busy,
        error: options.error,
        primaryAction: {
          id: 'queueSuuntoRouteCatchUp',
          label: 'Queue route catch-up',
          icon: 'playlist_add',
          loadingLabel: 'Queueing...',
        },
        secondaryAction: {
          id: 'dismissSuuntoRouteCatchUp',
          label: 'Not now',
        },
      };
  }
}
