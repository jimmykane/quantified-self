import {
  DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID,
  DashboardActionPromptViewModel,
} from './dashboard-action-prompt.helper';
import {
  getStableSuuntoServiceTokenSourceKey,
  getSuuntoProviderUserIdFromTokenLike,
  getSuuntoRouteImportSourceKeyFromTokenLike,
  SuuntoRouteImportStateEntry,
} from '@shared/suunto-route-import-state';

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

interface SuuntoRouteImportMetaLike {
  didLastRouteImport?: unknown;
  routeImportStatesByProviderSourceKey?: unknown;
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

function getSuuntoRouteImportStatesBySourceKey(
  serviceMeta: SuuntoRouteImportMetaLike | null | undefined,
): Record<string, SuuntoRouteImportStateEntry> {
  const rawStates = serviceMeta?.routeImportStatesByProviderSourceKey;
  if (!Array.isArray(rawStates) || rawStates.length === 0) {
    return {};
  }

  return rawStates.reduce<Record<string, SuuntoRouteImportStateEntry>>((result, rawState) => {
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
      return result;
    }

    const sourceKey = typeof (rawState as { sourceKey?: unknown }).sourceKey === 'string'
      && (rawState as { sourceKey: string }).sourceKey.trim().length > 0
      ? (rawState as { sourceKey: string }).sourceKey.trim()
      : null;

    if (!sourceKey) {
      return result;
    }

    result[sourceKey] = rawState as SuuntoRouteImportStateEntry;
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
      .map(token => getSuuntoProviderUserIdFromTokenLike(token))
      .filter((providerUserId): providerUserId is string => providerUserId !== null),
  )).sort((left, right) => left.localeCompare(right));
}

function getSuuntoConnectedProviderSourceKeys(serviceTokens: unknown): string[] {
  if (!Array.isArray(serviceTokens) || serviceTokens.length === 0) {
    return [];
  }

  return Array.from(new Set(
    serviceTokens
      .map(token => getSuuntoRouteImportSourceKeyFromTokenLike(token))
      .filter((sourceKey): sourceKey is string => sourceKey !== null),
  )).sort((left, right) => left.localeCompare(right));
}

export function getSuuntoRouteCatchUpDateForConnectedProviders(
  serviceMeta: SuuntoRouteImportMetaLike | null | undefined,
  serviceTokens: unknown,
): Date | null {
  const connectedProviderSourceKeys = getSuuntoConnectedProviderSourceKeys(serviceTokens);
  const providerStates = getSuuntoRouteImportStatesBySourceKey(serviceMeta);

  if (connectedProviderSourceKeys.length === 0) {
    return getSuuntoRouteCatchUpDate(serviceMeta?.didLastRouteImport);
  }

  if (Object.keys(providerStates).length === 0) {
    return null;
  }

  const connectedDates = connectedProviderSourceKeys.map(sourceKey => (
    getSuuntoRouteCatchUpDate(providerStates[sourceKey]?.didLastRouteImport)
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
      message: 'No Suunto routes were found.',
      duration: 3500,
    };
  }

  const messageParts = summary.totalCount === 0
    ? ['No Suunto routes were found.']
    : [`Route import started for ${summary.queuedCount} ${summary.queuedCount === 1 ? 'route' : 'routes'}.`];
  if (summary.skippedCount > 0) {
    messageParts.push(`Already up to date: ${summary.skippedCount}.`);
  }
  if (summary.failureCount > 0) {
    messageParts.push(`Could not import: ${summary.failureCount}.`);
  }
  if (failedProviderCount > 0) {
    messageParts.push(`Could not check ${failedProviderCount} connected ${failedProviderCount === 1 ? 'account' : 'accounts'}.`);
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

  const tokenSourceKey = getStableSuuntoServiceTokenSourceKey(options.serviceTokens);
  if (!tokenSourceKey) {
    return null;
  }

  return `${SUUNTO_ROUTE_CATCH_UP_PROMPT_SOURCE}:connected:${tokenSourceKey}`;
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
        description: 'Upgrade to Pro to import routes that are already saved in your Suunto account.',
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
        description: 'Reconnect Suunto before importing routes that are already saved in your Suunto account.',
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
        description: 'New and updated Suunto routes import automatically while connected. Import existing routes once to add your current Suunto route library.',
        busy: options.busy,
        error: options.error,
        primaryAction: {
          id: 'queueSuuntoRouteCatchUp',
          label: 'Import existing routes',
          icon: 'playlist_add',
          loadingLabel: 'Starting import...',
        },
        secondaryAction: {
          id: 'dismissSuuntoRouteCatchUp',
          label: 'Not now',
        },
      };
  }
}
