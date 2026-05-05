import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  AppAppSettingsInterface,
  AppDashboardActionPromptId,
  AppDashboardActionPromptState,
  AppDashboardActionPrompts,
} from '../models/app-user.interface';

export const DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID: AppDashboardActionPromptId = 'unitSetup';
export const DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID: AppDashboardActionPromptId = 'firstActivityUpload';
export const DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_ID: AppDashboardActionPromptId = 'connectActivityService';
export const DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_SOURCE = 'first-activity-upload';
export const DASHBOARD_ACTION_PROMPT_CONNECT_ACTIVITY_SERVICE_SOURCE = 'activity-service-connection';

export type DashboardActionPromptActionId =
  | 'applyUnitSetup'
  | 'dismissUnitSetup'
  | 'openUnitSettings'
  | 'upgradeToPro'
  | 'dismissFirstActivityUpload'
  | 'connectActivityService'
  | 'dismissConnectActivityService';

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
): boolean {
  return appSettings?.dashboardActionPrompts?.[id]?.state === 'dismissed';
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
      description: 'Start with FIT, GPX, TCX, JSON, or SML files. Upgrade to Pro when you want automatic imports from Garmin, Suunto, or COROS.',
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
      description: 'Import activities automatically by connecting Garmin, Suunto, or COROS.',
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
      }],
    });
  }

  return prompts;
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
