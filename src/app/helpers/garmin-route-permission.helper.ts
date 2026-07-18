import {
  DASHBOARD_ACTION_PROMPT_GARMIN_ROUTE_PERMISSION_ID,
  DashboardActionPromptViewModel,
} from './dashboard-action-prompt.helper';

export const GARMIN_ROUTE_PERMISSION_PROMPT_SOURCE = 'garmin-route-course-import';
export const GARMIN_ROUTE_PERMISSION_REQUIRED_PERMISSION = 'COURSE_IMPORT';

export interface BuildGarminRoutePermissionPromptSourceOptions {
  connected: boolean;
  reconnectRequired: boolean;
  tokenLike: unknown;
  missingPermissions: readonly string[];
}

export interface BuildGarminRoutePermissionPromptViewModelOptions {
  busy: boolean;
  error: string | null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toStableTimestampSource(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}`;
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getTime()}`;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsedDate = new Date(value);
    return Number.isNaN(parsedDate.getTime()) ? value.trim() : `${parsedDate.getTime()}`;
  }

  if (typeof (value as { toDate?: unknown } | null)?.toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? `${date.getTime()}` : null;
  }

  if (
    typeof (value as { seconds?: unknown } | null)?.seconds === 'number'
    && typeof (value as { nanoseconds?: unknown } | null)?.nanoseconds === 'number'
  ) {
    const timestamp = value as { seconds: number; nanoseconds: number };
    return `${(timestamp.seconds * 1000) + Math.round(timestamp.nanoseconds / 1000000)}`;
  }

  return null;
}

function getGarminRoutePermissionSourceVersion(tokenLike: unknown): string {
  if (!tokenLike || typeof tokenLike !== 'object' || Array.isArray(tokenLike)) {
    return 'unknown';
  }

  const token = tokenLike as {
    permissionsLastChangedAt?: unknown;
    dateCreated?: unknown;
  };

  return toStableTimestampSource(token.permissionsLastChangedAt)
    || toStableTimestampSource(token.dateCreated)
    || 'unknown';
}

function getProviderUserId(tokenLike: unknown): string | null {
  if (!tokenLike || typeof tokenLike !== 'object' || Array.isArray(tokenLike)) {
    return null;
  }

  return normalizeNonEmptyString((tokenLike as { userID?: unknown }).userID);
}

export function buildGarminRoutePermissionPromptSource(
  options: BuildGarminRoutePermissionPromptSourceOptions,
): string | null {
  if (
    !options.connected
    || options.reconnectRequired
    || !options.missingPermissions.includes(GARMIN_ROUTE_PERMISSION_REQUIRED_PERMISSION)
  ) {
    return null;
  }

  const providerUserId = getProviderUserId(options.tokenLike);
  if (!providerUserId) {
    return null;
  }

  const missingPermissionSource = Array.from(new Set(options.missingPermissions))
    .sort((left, right) => left.localeCompare(right))
    .join(',');

  return [
    GARMIN_ROUTE_PERMISSION_PROMPT_SOURCE,
    providerUserId,
    getGarminRoutePermissionSourceVersion(options.tokenLike),
    missingPermissionSource,
  ].join(':');
}

export function buildGarminRoutePermissionPromptViewModel(
  options: BuildGarminRoutePermissionPromptViewModelOptions,
): DashboardActionPromptViewModel {
  return {
    id: DASHBOARD_ACTION_PROMPT_GARMIN_ROUTE_PERMISSION_ID,
    icon: 'route',
    title: 'Allow saved routes to be sent to Garmin',
    description: 'Garmin is connected, but Course Import is off. In Garmin Connect, open Connected Apps, choose Quantified Self, allow Course Import, then reconnect Garmin here.',
    busy: options.busy,
    error: options.error,
    primaryAction: {
      id: 'reconnectGarminRoutePermission',
      label: 'Reconnect Garmin',
      icon: 'sync',
      loadingLabel: 'Redirecting...',
    },
    secondaryAction: {
      id: 'dismissGarminRoutePermission',
      label: 'Not now',
    },
  };
}
