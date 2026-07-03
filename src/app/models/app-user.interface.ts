import {
    User,
    ChartThemes,
    UserChartSettingsInterface,
    UserMyTracksSettingsInterface,
    UserSettingsInterface,
    ActivityTypes,
    UserAppSettingsInterface,
    UserDashboardSettingsInterface,
    UserMapSettingsInterface,
    DateRanges,
    TileChartSettingsInterface,
    TileMapSettingsInterface,
} from '@sports-alliance/sports-lib';
import { Timestamp } from 'app/firebase/firestore';
import { StripeRole } from './stripe-role.model';
import { AppThemePreference } from './app-theme-preference.type';
import { AppDateValue } from './app-date-value.type';
import { ActivitySyncRouteId } from '@shared/activity-sync-routes';
import { RouteDeliverySyncRouteId } from '@shared/route-delivery-sync-routes';
import { ServiceConnectionMetaFields } from '@shared/service-connection';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';

export type AppMapStyleName = 'default' | 'satellite' | 'outdoors';

export interface AppMapSettingsInterface extends UserMapSettingsInterface {
    mapStyle?: AppMapStyleName;
    is3D?: boolean;
}

export interface AppMyTracksSettings extends UserMyTracksSettingsInterface {
    is3D?: boolean;
    activityTypes?: ActivityTypes[];
    mapStyle?: 'default' | 'satellite' | 'outdoors';
    showJumpHeatmap?: boolean;
    startDate?: number | null;
    endDate?: number | null;
}

export type AppDashboardSleepTrendRange = '14d' | '30d' | '90d' | '1y';

export interface AppDashboardSleepTrendSettingsInterface {
    range?: AppDashboardSleepTrendRange;
}

export type AppDashboardAutoTileId =
    | 'sleepTrend'
    | 'curatedRecoveryNow'
    | 'curatedForm'
    | 'curatedFreshnessForecast'
    | 'curatedIntensityDistribution'
    | 'curatedEfficiencyTrend'
    | 'powerCurve'
    | 'kpiAcwr'
    | 'kpiRampRate'
    | 'kpiMonotonyStrain'
    | 'kpiLoadStatus'
    | 'kpiFormNow'
    | 'kpiFitnessCtl'
    | 'kpiFatigueAtl'
    | 'kpiFitnessTrend'
    | 'kpiFatigueTrend'
    | 'kpiRecoveryDebt'
    | 'kpiFormPlus7d'
    | 'kpiTrainingBalance'
    | 'kpiEasyPercent'
    | 'kpiHardPercent'
    | 'kpiEfficiencyDelta4w';
export type AppDashboardAutoTileStateValue = 'added' | 'dismissed';

export interface AppDashboardAutoTileState {
    state: AppDashboardAutoTileStateValue;
    addedAt?: number;
    dismissedAt?: number;
    lastQualifiedAt?: number;
    source?: string;
}

export type AppDashboardAutoTiles = Partial<Record<AppDashboardAutoTileId, AppDashboardAutoTileState>>
    & Record<string, AppDashboardAutoTileState | undefined>;

export type AppDashboardActionPromptId =
    | 'unitSetup'
    | 'firstActivityUpload'
    | 'connectActivityService'
    | 'enableActivityAutoSync'
    | 'backfillGarminSleep'
    | 'reconnectSuuntoService'
    | 'suuntoRouteCatchUp'
    | 'garminRoutePermission'
    | 'enableRouteDeliveryAutoSync';
export type AppDashboardActionPromptStateValue = 'dismissed';

export interface AppDashboardActionPromptState {
    state: AppDashboardActionPromptStateValue;
    dismissedAt?: number;
    source?: string;
}

export type AppDashboardActionPrompts = Partial<Record<AppDashboardActionPromptId, AppDashboardActionPromptState>>
    & Record<string, AppDashboardActionPromptState | undefined>;

export type AppDashboardTileEventFilterRange =
    'thisWeek'
    | 'thisMonth'
    | '14d'
    | '30d'
    | '90d'
    | '1y'
    | '2y'
    | '3y'
    | '4y'
    | 'all';

export interface AppDashboardEventTableFiltersInterface {
    searchTerm: string | null;
    dateRange: DateRanges;
    startDate: number | null;
    endDate: number | null;
    activityTypes: ActivityTypes[];
    includeMergedEvents: boolean;
}

export interface AppDashboardTileEventFiltersInterface {
    range?: AppDashboardTileEventFilterRange;
    activityTypes?: ActivityTypes[];
}

export type AppDashboardDerivedChartRange = '8w' | '12w' | '6m' | '1y' | 'all';
export type AppDashboardFormTimelineWindow = 'w' | 'm' | 'y';

export interface AppDashboardChartTileDisplaySettingsInterface {
    derivedChartRange?: AppDashboardDerivedChartRange;
    formTimelineWindow?: AppDashboardFormTimelineWindow;
}

export interface AppDashboardChartTileSettingsInterface extends TileChartSettingsInterface {
    eventFilters?: AppDashboardTileEventFiltersInterface;
    displaySettings?: AppDashboardChartTileDisplaySettingsInterface;
}

export interface AppDashboardMapTileSettingsInterface extends TileMapSettingsInterface {
    mapStyle?: AppMapStyleName;
    eventFilters?: AppDashboardTileEventFiltersInterface;
}

export interface AppDashboardSettingsInterface extends UserDashboardSettingsInterface {
    includeMergedEvents?: boolean;
    dismissedCuratedRecoveryNowTile?: boolean;
    sleepTrend?: AppDashboardSleepTrendSettingsInterface;
    autoTiles?: AppDashboardAutoTiles;
    eventTableFilters?: AppDashboardEventTableFiltersInterface;
}

export interface AppChartSettingsInterface extends Omit<UserChartSettingsInterface, 'theme' | 'extraMaxForPower' | 'extraMaxForPace'> {
    theme?: ChartThemes;
    fillOpacityVersion?: number;
    syncChartHoverToMap?: boolean;
    eventChartOverlayDataTypeByPrimary?: Record<string, string>;
    colorAltitudeByGrade?: boolean;
    showSwimLengths: boolean;
}

export interface AppAppSettingsInterface extends UserAppSettingsInterface {
    lastSeenChangelogDate?: AppDateValue;
    themePreference?: AppThemePreference;
    unitSetupCompleted?: boolean;
    dashboardActionPrompts?: AppDashboardActionPrompts;
}

export interface ActivitySyncRouteSettingsInterface {
    enabled?: boolean;
}

export interface RouteDeliverySyncRouteSettingsInterface {
    enabled?: boolean;
}

export interface ServiceSyncSettingsInterface {
    activitySyncRoutes?: Partial<Record<ActivitySyncRouteId, ActivitySyncRouteSettingsInterface>>;
    routeDeliverySyncRoutes?: Partial<Record<RouteDeliverySyncRouteId, RouteDeliverySyncRouteSettingsInterface>>;
}

export interface AppDeviceDisplaySettingsInterface {
    deviceColorByName?: Record<string, string>;
}

export interface AppUserServiceMetaInterface extends UserServiceMetaInterface, ServiceConnectionMetaFields {
    didLastRouteImport?: AppDateValue;
    queuedRoutesFromLastRouteImportCount?: number;
    skippedRoutesFromLastRouteImportCount?: number;
    failedRoutesFromLastRouteImportCount?: number;
    failedRouteImportProviderCount?: number;
    totalRoutesFromLastRouteImportCount?: number;
    routeImportStatesByProviderSourceKey?: Array<{
        sourceKey: string;
        providerUserId: string;
        didLastRouteImport?: AppDateValue;
        queuedCount?: number;
        skippedCount?: number;
        failureCount?: number;
        totalCount?: number;
        updatedAt?: AppDateValue;
    }>;
    routeImportStatesByProviderUserId?: Record<string, {
        didLastRouteImport?: AppDateValue;
        queuedCount?: number;
        skippedCount?: number;
        failureCount?: number;
        totalCount?: number;
        updatedAt?: AppDateValue;
    } | undefined>;
}

export interface AppUserSettingsInterface extends UserSettingsInterface {
    myTracksSettings?: AppMyTracksSettings;
    mapSettings?: AppMapSettingsInterface;
    dashboardSettings?: AppDashboardSettingsInterface;
    appSettings?: AppAppSettingsInterface;
    serviceSyncSettings?: ServiceSyncSettingsInterface;
    deviceDisplaySettings?: AppDeviceDisplaySettingsInterface;
}

export interface AppUserInterface extends User {
    email?: string | null;
    displayName?: string | null;
    photoURL?: string | null;
    emailVerified?: boolean;
    acceptedTos?: boolean;
    acceptedMarketingPolicy?: boolean;
    hasSubscribedOnce?: boolean;
    onboardingCompleted?: boolean;
    claimsUpdatedAt?: Timestamp | null;
    settings?: AppUserSettingsInterface;
    stripeRole?: StripeRole | null;
    gracePeriodUntil?: { seconds: number, nanoseconds: number } | { toDate: () => Date; toMillis?: () => number } | Date | number | null;
    admin?: boolean;
    impersonatedBy?: string;
}
