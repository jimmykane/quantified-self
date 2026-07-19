import {
  DASHBOARD_ACTION_PROMPT_ROUTE_DELIVERY_AUTO_SYNC_ID,
  DashboardActionPromptViewModel,
} from './dashboard-action-prompt.helper';

export interface BuildRouteDeliveryAutoSyncPromptViewModelOptions {
  busy: boolean;
  error: string | null;
}

export function buildRouteDeliveryAutoSyncPromptViewModel(
  options: BuildRouteDeliveryAutoSyncPromptViewModelOptions,
): DashboardActionPromptViewModel {
  return {
    id: DASHBOARD_ACTION_PROMPT_ROUTE_DELIVERY_AUTO_SYNC_ID,
    icon: 'sync_alt',
    title: 'Sync Suunto routes to Garmin courses',
    description: 'Automatically send new and updated Suunto routes to Garmin. You can also send routes already saved in Quantified Self from Connections.',
    busy: options.busy,
    error: options.error,
    primaryAction: {
      id: 'enableRouteDeliveryAutoSync',
      label: 'Send routes automatically',
      icon: 'sync',
      loadingLabel: 'Enabling...',
    },
    secondaryAction: {
      id: 'dismissRouteDeliveryAutoSync',
      label: 'Not now',
    },
  };
}
