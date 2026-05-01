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
}

export type AppDashboardSleepTrendRange = '14d' | '30d' | '90d' | '1y';

export interface AppDashboardSleepTrendSettingsInterface {
    range?: AppDashboardSleepTrendRange;
}

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

export interface AppDashboardChartTileSettingsInterface extends TileChartSettingsInterface {
    eventFilters?: AppDashboardTileEventFiltersInterface;
}

export interface AppDashboardMapTileSettingsInterface extends TileMapSettingsInterface {
    mapStyle?: AppMapStyleName;
    eventFilters?: AppDashboardTileEventFiltersInterface;
}

export interface AppDashboardSettingsInterface extends UserDashboardSettingsInterface {
    includeMergedEvents?: boolean;
    dismissedCuratedRecoveryNowTile?: boolean;
    sleepTrend?: AppDashboardSleepTrendSettingsInterface;
    eventTableFilters?: AppDashboardEventTableFiltersInterface;
}

export interface AppChartSettingsInterface extends Omit<UserChartSettingsInterface, 'theme' | 'extraMaxForPower' | 'extraMaxForPace'> {
    theme?: ChartThemes;
    fillOpacityVersion?: number;
    syncChartHoverToMap?: boolean;
}

export interface AppAppSettingsInterface extends UserAppSettingsInterface {
    lastSeenChangelogDate?: AppDateValue;
    themePreference?: AppThemePreference;
    unitSetupCompleted?: boolean;
}

export interface ActivitySyncRouteSettingsInterface {
    enabled?: boolean;
}

export interface ServiceSyncSettingsInterface {
    activitySyncRoutes?: Partial<Record<ActivitySyncRouteId, ActivitySyncRouteSettingsInterface>>;
}

export interface AppUserSettingsInterface extends UserSettingsInterface {
    myTracksSettings?: AppMyTracksSettings;
    mapSettings?: AppMapSettingsInterface;
    dashboardSettings?: AppDashboardSettingsInterface;
    appSettings?: AppAppSettingsInterface;
    serviceSyncSettings?: ServiceSyncSettingsInterface;
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
