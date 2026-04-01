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
import { Timestamp } from 'app/firebase/firestore';
import { StripeRole } from './stripe-role.model';
import { AppThemePreference } from './app-theme-preference.type';
import { AppDateValue } from './app-date-value.type';

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
    dismissedCuratedRecoveryNowTile?: boolean;
}

export interface AppChartSettingsInterface extends Omit<UserChartSettingsInterface, 'theme' | 'extraMaxForPower' | 'extraMaxForPace'> {
    theme?: ChartThemes;
    fillOpacityVersion?: number;
    syncChartHoverToMap?: boolean;
}

export interface AppAppSettingsInterface extends UserAppSettingsInterface {
    lastSeenChangelogDate?: AppDateValue;
    themePreference?: AppThemePreference;
}

export interface AppUserSettingsInterface extends UserSettingsInterface {
    myTracksSettings?: AppMyTracksSettings;
    mapSettings?: AppMapSettingsInterface;
    dashboardSettings?: AppDashboardSettingsInterface;
    appSettings?: AppAppSettingsInterface;
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
