import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  AppAppSettingsInterface,
  AppDashboardActionPromptId,
  AppDashboardActionPromptState,
  AppDashboardActionPrompts,
  ActivitySyncRouteSettingsInterface,
} from '../models/app-user.interface';
import {
  ACTIVITY_SYNC_ROUTE_IDS,
  ACTIVITY_SYNC_ROUTES,
  ActivitySyncRouteId,
} from '@shared/activity-sync-routes';
import { isActivitySyncRouteUIDAllowlisted } from '@shared/activity-sync-rollout';
import { getProviderDisplayName } from '@shared/provider-presentation';

export const DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID: AppDashboardActionPromptId = 'unitSetup';
export const DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID: AppDashboardActionPromptId = 'firstActivityUpload';
export const DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID: AppDashboardActionPromptId = 'connectActivityService';
export const DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID: AppDashboardActionPromptId = 'enableActivityAutoSync';
export const DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_ID: AppDashboardActionPromptId = 'backfillGarminSleep';
export const DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_ID: AppDashboardActionPromptId = 'reconnectSuuntoService';
export const DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID: AppDashboardActionPromptId = 'suuntoRouteCatchUp';
export const DASHBOARD_ACTION_PROMPT_GARMIN_ROUTE_PERMISSION_ID: AppDashboardActionPromptId = 'garminRoutePermission';
export const DASHBOARD_ACTION_PROMPT_ROUTE_DELIVERY_AUTO_SYNC_ID: AppDashboardActionPromptId = 'enableRouteDeliveryAutoSync';
export const DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_SOURCE = 'first-activity-upload';
export const DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_SOURCE = 'activity-service-connection';
export const DASHBOARD_ACTION_PROMPT_ACTIVITY_AUTO_SYNC_SOURCE = 'activity-auto-sync';
export const DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_SOURCE = 'garmin-sleep-backfill';
export const DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_SOURCE = 'suunto-reconnect-required';
export const DASHBOARD_ACTION_PROMPT_ROUTE_DELIVERY_AUTO_SYNC_SOURCE = 'route-delivery-auto-sync';

export const DASHBOARD_ACTIVITY_AUTO_SYNC_ROUTE_IDS: readonly ActivitySyncRouteId[] = [
  ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
  ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
];

export type DashboardActionPromptActionId =
  | 'applyUnitSetup'
  | 'dismissUnitSetup'
  | 'openUnitSettings'
  | 'upgradeToPro'
  | 'dismissFirstActivityUpload'
  | 'connectActivityService'
  | 'dismissConnectActivityService'
  | 'enableActivityAutoSync'
  | 'dismissEnableActivityAutoSync'
  | 'backfillGarminSleep'
  | 'dismissBackfillGarminSleep'
  | 'reconnectSuuntoService'
  | 'dismissReconnectSuuntoService'
  | 'queueSuuntoRouteCatchUp'
  | 'dismissSuuntoRouteCatchUp'
  | 'reconnectGarminRoutePermission'
  | 'dismissGarminRoutePermission'
  | 'enableRouteDeliveryAutoSync'
  | 'dismissRouteDeliveryAutoSync';

export type DashboardActionPromptMenuActionId =
  | 'openUnitSettings'
  | 'connectServiceProvider';

export interface DashboardActionPromptAction {
  id: DashboardActionPromptActionId;
  label: string;
  icon?: string;
  loadingLabel?: string;
  menuTrigger?: boolean;
  disabled?: boolean;
}

export interface DashboardActionPromptMenuAction {
  id: DashboardActionPromptMenuActionId;
  label: string;
  icon?: string;
  value?: ServiceNames | string;
  serviceName?: ServiceNames;
}

export interface DashboardActionPromptViewModel {
  id: AppDashboardActionPromptId;
  icon: string;
  title: string;
  description: string;
  primaryAction?: DashboardActionPromptAction;
  secondaryAction?: DashboardActionPromptAction;
  menuActions?: DashboardActionPromptMenuAction[];
  busy?: boolean;
  error?: string | null;
}

export interface DashboardActionPromptEvent {
  promptId: AppDashboardActionPromptId;
  action: DashboardActionPromptAction;
}

export interface DashboardActionPromptMenuEvent {
  promptId: AppDashboardActionPromptId;
  action: DashboardActionPromptMenuAction;
}

export interface DashboardActionPromptControlChange {
  promptId: AppDashboardActionPromptId;
  value: unknown;
}

export interface DashboardActionPromptBuildOptions {
  showUnitSetupPrompt: boolean;
  unitSetupBusy: boolean;
  unitSetupError: string | null;
  showFirstActivityUploadPrompt: boolean;
  firstActivityUploadBusy: boolean;
  firstActivityUploadError: string | null;
  showConnectActivityServicePrompt: boolean;
  connectActivityServiceBusy: boolean;
  connectActivityServiceError: string | null;
  showEnableActivityAutoSyncPrompt: boolean;
  enableActivityAutoSyncBusy: boolean;
  enableActivityAutoSyncError: string | null;
  enableActivityAutoSyncRouteIds: readonly ActivitySyncRouteId[];
  showBackfillGarminSleepPrompt: boolean;
  backfillGarminSleepBusy: boolean;
  backfillGarminSleepError: string | null;
  showReconnectSuuntoServicePrompt: boolean;
  reconnectSuuntoServiceBusy: boolean;
  reconnectSuuntoServiceError: string | null;
}

export interface ResolveDashboardActivityAutoSyncRouteIdsOptions {
  userID: string | null | undefined;
  connectionState: Partial<Record<ServiceNames, boolean>> | null | undefined;
  reconnectRequiredServices?: Partial<Record<ServiceNames, boolean>> | null | undefined;
  routeSettings: Partial<Record<ActivitySyncRouteId, ActivitySyncRouteSettingsInterface>> | null | undefined;
}

export function normalizeDashboardActionPrompts(value: unknown): AppDashboardActionPrompts {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.entries(value as Record<string, unknown>)
    .reduce<AppDashboardActionPrompts>((normalized, [id, state]) => {
      const normalizedState = normalizeDashboardActionPromptState(state);
      if (normalizedState) {
        normalized[id] = normalizedState;
      }
      return normalized;
    }, {});
}

export function isDashboardActionPromptDismissed(
  appSettings: AppAppSettingsInterface | null | undefined,
  id: AppDashboardActionPromptId,
  source?: string | null,
): boolean {
  const promptState = appSettings?.dashboardActionPrompts?.[id];
  if (promptState?.state !== 'dismissed') {
    return false;
  }
  if (!source) {
    return true;
  }
  return promptState.source === source;
}

export function markDashboardActionPromptDismissed(
  appSettings: AppAppSettingsInterface,
  id: AppDashboardActionPromptId,
  source: string,
  timestampMs: number,
): AppDashboardActionPromptState {
  const state: AppDashboardActionPromptState = {
    state: 'dismissed',
    dismissedAt: timestampMs,
    source,
  };
  appSettings.dashboardActionPrompts = {
    ...(appSettings.dashboardActionPrompts || {}),
    [id]: state,
  };
  return state;
}

export function buildReconnectSuuntoServicePromptSource(lastDisconnectedAt: number | null | undefined): string {
  return `${DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_SOURCE}:${Number.isFinite(lastDisconnectedAt) ? lastDisconnectedAt : 'unknown'}`;
}

export function resolveDashboardActivityAutoSyncRouteIds(
  options: ResolveDashboardActivityAutoSyncRouteIdsOptions,
): ActivitySyncRouteId[] {
  const userID = `${options.userID || ''}`.trim();
  const connectionState = options.connectionState;
  const reconnectRequiredServices = options.reconnectRequiredServices || {};
  if (
    !userID ||
    !connectionState?.[ServiceNames.SuuntoApp] ||
    reconnectRequiredServices[ServiceNames.SuuntoApp] === true
  ) {
    return [];
  }

  return DASHBOARD_ACTIVITY_AUTO_SYNC_ROUTE_IDS.filter(routeID => {
    const route = ACTIVITY_SYNC_ROUTES[routeID];
    return connectionState[route.sourceServiceName] === true
      && reconnectRequiredServices[route.sourceServiceName] !== true
      && reconnectRequiredServices[route.destinationServiceName] !== true
      && options.routeSettings?.[routeID]?.enabled !== true
      && isActivitySyncRouteUIDAllowlisted(routeID, userID);
  });
}

export function buildActivityAutoSyncEnabledSnackbarMessage(routeIds: readonly ActivitySyncRouteId[]): string {
  return `New activities from ${formatActivityAutoSyncRouteSourceLabel(routeIds)} will be sent to Suunto automatically.`;
}

export function buildDashboardActionPromptViewModels(
  options: DashboardActionPromptBuildOptions,
): DashboardActionPromptViewModel[] {
  const prompts: DashboardActionPromptViewModel[] = [];

  if (options.showUnitSetupPrompt) {
    prompts.push({
      id: DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID,
      icon: 'straighten',
      title: 'Default units',
      description: 'Choose the units most of the dashboard should use. You can fine-tune them later in Settings.',
      busy: options.unitSetupBusy,
      error: options.unitSetupError,
      primaryAction: {
        id: 'applyUnitSetup',
        label: 'Apply',
        loadingLabel: 'Saving...',
      },
      secondaryAction: {
        id: 'dismissUnitSetup',
        label: 'Not now',
      },
      menuActions: [{
        id: 'openUnitSettings',
        label: 'Advanced settings',
        icon: 'tune',
      }],
    });
  }

  if (options.showFirstActivityUploadPrompt) {
    prompts.push({
      id: DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
      icon: 'upload_file',
      title: 'Upload your first activities',
      description: 'Start with FIT, GPX, TCX, JSON, or SML files. Upgrade to Pro when you want automatic imports from Garmin, Suunto, COROS, or Wahoo.',
      busy: options.firstActivityUploadBusy,
      error: options.firstActivityUploadError,
      primaryAction: {
        id: 'upgradeToPro',
        label: 'Upgrade to Pro',
        icon: 'workspace_premium',
      },
      secondaryAction: {
        id: 'dismissFirstActivityUpload',
        label: 'Not now',
      },
    });
  }

  if (options.showConnectActivityServicePrompt) {
    prompts.push({
      id: DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID,
      icon: 'sync',
      title: 'Connect a service',
      description: 'Import activities automatically by connecting Garmin, Suunto, COROS, or Wahoo.',
      busy: options.connectActivityServiceBusy,
      error: options.connectActivityServiceError,
      primaryAction: {
        id: 'connectActivityService',
        label: 'Connect service',
        icon: 'add_link',
        menuTrigger: true,
      },
      secondaryAction: {
        id: 'dismissConnectActivityService',
        label: 'Not now',
      },
      menuActions: [{
        id: 'connectServiceProvider',
        label: 'Garmin',
        value: ServiceNames.GarminAPI,
        serviceName: ServiceNames.GarminAPI,
      }, {
        id: 'connectServiceProvider',
        label: 'Suunto',
        value: ServiceNames.SuuntoApp,
        serviceName: ServiceNames.SuuntoApp,
      }, {
        id: 'connectServiceProvider',
        label: 'COROS',
        value: ServiceNames.COROSAPI,
        serviceName: ServiceNames.COROSAPI,
      }, {
        id: 'connectServiceProvider',
        label: 'Wahoo',
        value: ServiceNames.WahooAPI,
        serviceName: ServiceNames.WahooAPI,
      }],
    });
  }

  if (options.showEnableActivityAutoSyncPrompt && options.enableActivityAutoSyncRouteIds.length > 0) {
    prompts.push({
      id: DASHBOARD_ACTION_PROMPT_ENABLE_ACTIVITY_AUTO_SYNC_ID,
      icon: 'published_with_changes',
      title: 'Send new activities to Suunto',
      description: `Automatically send new ${formatActivityAutoSyncRouteSourceLabel(options.enableActivityAutoSyncRouteIds)} activities to Suunto. You can sync past activities separately from Connections.`,
      busy: options.enableActivityAutoSyncBusy,
      error: options.enableActivityAutoSyncError,
      primaryAction: {
        id: 'enableActivityAutoSync',
        label: 'Send automatically',
        loadingLabel: 'Enabling...',
        icon: 'sync',
      },
      secondaryAction: {
        id: 'dismissEnableActivityAutoSync',
        label: 'Not now',
      },
    });
  }

  if (options.showBackfillGarminSleepPrompt) {
    prompts.push({
      id: DASHBOARD_ACTION_PROMPT_BACKFILL_GARMIN_SLEEP_ID,
      icon: 'bedtime',
      title: 'Import Garmin sleep history',
      description: 'Import Garmin sleep records from January 1, 2016 to today. Records may appear gradually over the next few hours.',
      busy: options.backfillGarminSleepBusy,
      error: options.backfillGarminSleepError,
      primaryAction: {
        id: 'backfillGarminSleep',
        label: 'Import sleep history',
        loadingLabel: 'Requesting...',
        icon: 'bedtime',
      },
      secondaryAction: {
        id: 'dismissBackfillGarminSleep',
        label: 'Not now',
      },
    });
  }

  if (options.showReconnectSuuntoServicePrompt) {
    prompts.push({
      id: DASHBOARD_ACTION_PROMPT_RECONNECT_SUUNTO_SERVICE_ID,
      icon: 'sync_problem',
      title: 'Reconnect Suunto',
      description: 'Suunto stopped accepting the previous connection. Reconnect to resume sleep sync, history imports, and uploads. Automatic activity sync from Garmin and COROS stays off until you turn it on again.',
      busy: options.reconnectSuuntoServiceBusy,
      error: options.reconnectSuuntoServiceError,
      primaryAction: {
        id: 'reconnectSuuntoService',
        label: 'Reconnect',
        icon: 'sync',
        loadingLabel: 'Redirecting...',
      },
      secondaryAction: {
        id: 'dismissReconnectSuuntoService',
        label: 'Not now',
      },
    });
  }

  return prompts;
}

function formatActivityAutoSyncRouteSourceLabel(routeIds: readonly ActivitySyncRouteId[]): string {
  const sourceLabels = routeIds
    .map(routeId => ACTIVITY_SYNC_ROUTES[routeId]?.sourceServiceName)
    .filter((serviceName): serviceName is ServiceNames => !!serviceName)
    .map(getActivityServiceDisplayName);

  return formatList(sourceLabels.length ? sourceLabels : [
    getProviderDisplayName(ServiceNames.GarminAPI, 'source'),
    getProviderDisplayName(ServiceNames.COROSAPI, 'source'),
  ]);
}

function getActivityServiceDisplayName(serviceName: ServiceNames): string {
  return getProviderDisplayName(serviceName, 'source');
}

function formatList(labels: readonly string[]): string {
  const uniqueLabels = labels.filter((label, index) => labels.indexOf(label) === index);
  if (uniqueLabels.length <= 1) {
    return uniqueLabels[0] || '';
  }
  if (uniqueLabels.length === 2) {
    return `${uniqueLabels[0]} and ${uniqueLabels[1]}`;
  }
  return `${uniqueLabels.slice(0, -1).join(', ')}, and ${uniqueLabels[uniqueLabels.length - 1]}`;
}

function normalizeDashboardActionPromptState(value: unknown): AppDashboardActionPromptState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const state = value as Partial<AppDashboardActionPromptState>;
  if (state.state !== 'dismissed') {
    return null;
  }

  const normalized: AppDashboardActionPromptState = { state: 'dismissed' };
  const dismissedAt = normalizeOptionalTimestamp(state.dismissedAt);
  const source = typeof state.source === 'string' ? state.source.trim() : '';

  if (dismissedAt !== null) {
    normalized.dismissedAt = dismissedAt;
  }
  if (source) {
    normalized.source = source;
  }

  return normalized;
}

function normalizeOptionalTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
