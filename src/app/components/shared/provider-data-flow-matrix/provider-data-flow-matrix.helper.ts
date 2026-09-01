import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  ACTIVITY_SYNC_ROUTES,
  type ActivitySyncRouteId,
} from '@shared/activity-sync-routes';
import { isActivitySyncRouteUIDAllowlisted } from '@shared/activity-sync-rollout';
import {
  ROUTE_DELIVERY_SYNC_ROUTES,
  type RouteDeliverySyncRouteId,
} from '@shared/route-delivery-sync-routes';
import { isRouteDeliverySyncRouteUIDAllowlisted } from '@shared/route-delivery-sync-rollout';
import { getProviderDisplayName } from '@shared/provider-presentation';

export type ProviderServiceSectionId = 'suunto' | 'garmin' | 'coros' | 'wahoo';
export type ProviderDataFlowToolId = 'routes' | 'auto-sync' | 'activity-sync';
export type ProviderDataFlowActivityDestination = Exclude<ProviderServiceSectionId, 'garmin'>;
export type ProviderDataFlowRouteKind = 'activity' | 'route';
export type ProviderDataFlowRouteState = 'available' | 'active' | 'attention';

export interface ProviderDataFlowToolLaunch {
  tool: ProviderDataFlowToolId;
  title: string;
  activitySyncDestination?: ProviderDataFlowActivityDestination;
}

export interface ProviderDataFlowMatrixRoute extends ProviderDataFlowToolLaunch {
  id: string;
  kind: ProviderDataFlowRouteKind;
  state: ProviderDataFlowRouteState;
  sourceSection: ProviderServiceSectionId;
}

export interface ProviderDataFlowMatrixCell {
  id: string;
  destinationServiceName: ServiceNames;
  destinationLabel: string;
  destinationConnected: boolean;
  routes: ProviderDataFlowMatrixRoute[];
}

export interface ProviderDataFlowMatrixRow {
  sourceServiceName: ServiceNames;
  sourceLabel: string;
  sourceConnected: boolean;
  cells: ProviderDataFlowMatrixCell[];
}

export interface ProviderDataFlowSummary {
  connectedServiceCount: number;
  matrixRows: readonly ProviderDataFlowMatrixRow[];
}

type RouteEnabledSetting = { enabled?: boolean } | undefined;

export interface BuildProviderDataFlowSummaryOptions {
  uid: string;
  serviceConnectionState: Record<ProviderServiceSectionId, boolean>;
  activityRouteSettings?: Partial<Record<ActivitySyncRouteId, RouteEnabledSetting>>;
  routeDeliverySettings?: Partial<Record<RouteDeliverySyncRouteId, RouteEnabledSetting>>;
}

export const PROVIDER_SECTION_BY_SERVICE: Record<ServiceNames, ProviderServiceSectionId> = {
  [ServiceNames.GarminAPI]: 'garmin',
  [ServiceNames.SuuntoApp]: 'suunto',
  [ServiceNames.COROSAPI]: 'coros',
  [ServiceNames.WahooAPI]: 'wahoo',
};

const PROVIDER_DATA_FLOW_SERVICES: readonly ServiceNames[] = [
  ServiceNames.GarminAPI,
  ServiceNames.SuuntoApp,
  ServiceNames.COROSAPI,
  ServiceNames.WahooAPI,
];

const DISCONNECTED_PROVIDER_STATE: Record<ProviderServiceSectionId, boolean> = {
  garmin: false,
  suunto: false,
  coros: false,
  wahoo: false,
};

export function createEmptyProviderDataFlowSummary(): ProviderDataFlowSummary {
  return {
    connectedServiceCount: 0,
    matrixRows: [],
  };
}

export function buildProviderDataFlowSummary(
  options: BuildProviderDataFlowSummaryOptions,
): ProviderDataFlowSummary {
  const matrixRows = PROVIDER_DATA_FLOW_SERVICES.map((sourceServiceName) => ({
    sourceServiceName,
    sourceLabel: getProviderDisplayName(sourceServiceName, 'source'),
    sourceConnected: options.serviceConnectionState[PROVIDER_SECTION_BY_SERVICE[sourceServiceName]],
    cells: PROVIDER_DATA_FLOW_SERVICES.map((destinationServiceName) => ({
      id: `${sourceServiceName}-to-${destinationServiceName}`,
      destinationServiceName,
      destinationLabel: getProviderDisplayName(destinationServiceName, 'destination'),
      destinationConnected: options.serviceConnectionState[PROVIDER_SECTION_BY_SERVICE[destinationServiceName]],
      routes: [],
    })),
  }));
  const matrixCellByRoute = new Map<string, ProviderDataFlowMatrixCell>();
  for (const row of matrixRows) {
    for (const cell of row.cells) {
      matrixCellByRoute.set(cell.id, cell);
    }
  }

  const addRoute = (
    id: string,
    kind: ProviderDataFlowRouteKind,
    sourceServiceName: ServiceNames,
    destinationServiceName: ServiceNames,
    enabled: boolean,
  ): void => {
    const cell = matrixCellByRoute.get(`${sourceServiceName}-to-${destinationServiceName}`);
    if (!cell) {
      return;
    }

    const sourceSection = PROVIDER_SECTION_BY_SERVICE[sourceServiceName];
    const destinationSection = PROVIDER_SECTION_BY_SERVICE[destinationServiceName];
    const sourceConnected = options.serviceConnectionState[sourceSection];
    const destinationConnected = options.serviceConnectionState[destinationSection];
    cell.routes.push({
      id: `${kind}-${id}`,
      kind,
      state: !enabled
        ? 'available'
        : sourceConnected && destinationConnected
          ? 'active'
          : 'attention',
      sourceSection,
      tool: kind === 'route'
        ? 'routes'
        : sourceSection === 'suunto'
          ? 'activity-sync'
          : 'auto-sync',
      title: `${kind === 'activity' ? 'Send activities' : 'Send routes'} to ${getProviderDisplayName(destinationServiceName, 'destination')}`,
      activitySyncDestination: kind === 'activity' && destinationSection !== 'garmin'
        ? destinationSection
        : undefined,
    });
  };

  for (const route of Object.values(ACTIVITY_SYNC_ROUTES)) {
    if (!isActivitySyncRouteUIDAllowlisted(route.id, options.uid)) {
      continue;
    }
    addRoute(
      route.id,
      'activity',
      route.sourceServiceName,
      route.destinationServiceName,
      options.activityRouteSettings?.[route.id]?.enabled === true,
    );
  }

  for (const route of Object.values(ROUTE_DELIVERY_SYNC_ROUTES)) {
    if (!isRouteDeliverySyncRouteUIDAllowlisted(route.id, options.uid)) {
      continue;
    }
    addRoute(
      route.id,
      'route',
      route.sourceServiceName,
      route.destinationServiceName,
      options.routeDeliverySettings?.[route.id]?.enabled === true,
    );
  }

  return {
    connectedServiceCount: Object.values(options.serviceConnectionState).filter(Boolean).length,
    matrixRows,
  };
}

export function buildPublicProviderDataFlowRows(): readonly ProviderDataFlowMatrixRow[] {
  return buildProviderDataFlowSummary({
    uid: 'public-provider-capability-matrix',
    serviceConnectionState: DISCONNECTED_PROVIDER_STATE,
  }).matrixRows;
}
