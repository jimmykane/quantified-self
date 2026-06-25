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
    description: 'Enable future Suunto route imports and updates to be delivered to Garmin as courses. Existing saved routes can still be queued from Services.',
    busy: options.busy,
    error: options.error,
    primaryAction: {
      id: 'enableRouteDeliveryAutoSync',
      label: 'Enable route sync',
      icon: 'sync',
      loadingLabel: 'Enabling...',
    },
    secondaryAction: {
      id: 'dismissRouteDeliveryAutoSync',
      label: 'Not now',
    },
  };
}
