import { User, UserMyTracksSettingsInterface, UserSettingsInterface, ActivityTypes, UserAppSettingsInterface } from '@sports-alliance/sports-lib';

export interface AppMyTracksSettings extends UserMyTracksSettingsInterface {
    is3D?: boolean;
    activityTypes?: ActivityTypes[];
    mapStyle?: 'default' | 'satellite' | 'outdoors';
}

export interface AppAppSettingsInterface extends UserAppSettingsInterface {
    lastSeenChangelogDate?: { seconds: number, nanoseconds: number } | Date;
}

export interface AppUserSettingsInterface extends UserSettingsInterface {
    myTracksSettings?: AppMyTracksSettings;
    appSettings?: AppAppSettingsInterface;
}

export interface AppUserInterface extends User {
    acceptedMarketingPolicy?: boolean;
    claimsUpdatedAt?: { seconds: number, nanoseconds: number } | Date;
    settings?: AppUserSettingsInterface;
}
