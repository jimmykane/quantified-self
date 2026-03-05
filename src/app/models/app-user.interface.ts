import {
    User,
    ChartThemes,
    UserChartSettingsInterface,
    UserMyTracksSettingsInterface,
    UserSettingsInterface,
    ActivityTypes,
    UserAppSettingsInterface,
    UserDashboardSettingsInterface,
    UserMapSettingsInterface
} from '@sports-alliance/sports-lib';
import { Timestamp } from '@angular/fire/firestore';
import { StripeRole } from './stripe-role.model';
import { AppThemePreference } from './app-theme-preference.type';

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

export interface AppDashboardSettingsInterface extends UserDashboardSettingsInterface {
    includeMergedEvents?: boolean;
}

export interface AppChartSettingsInterface extends Omit<UserChartSettingsInterface, 'theme' | 'extraMaxForPower' | 'extraMaxForPace'> {
    theme?: ChartThemes;
    fillOpacityVersion?: number;
    syncChartHoverToMap?: boolean;
}

export interface AppAppSettingsInterface extends UserAppSettingsInterface {
    lastSeenChangelogDate?: { seconds: number, nanoseconds: number } | Date;
    themePreference?: AppThemePreference;
}

export interface AppUserSettingsInterface extends UserSettingsInterface {
    myTracksSettings?: AppMyTracksSettings;
    mapSettings?: AppMapSettingsInterface;
    dashboardSettings?: AppDashboardSettingsInterface;
    appSettings?: AppAppSettingsInterface;
}

export interface AppUserInterface extends User {
    acceptedMarketingPolicy?: boolean;
    claimsUpdatedAt?: Timestamp | null;
    settings?: AppUserSettingsInterface;
    stripeRole?: StripeRole | null;
    gracePeriodUntil?: { seconds: number, nanoseconds: number } | { toDate: () => Date; toMillis?: () => number } | Date | number | null;
    admin?: boolean;
}
