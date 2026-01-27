import { User, UserMyTracksSettingsInterface, UserSettingsInterface, ActivityTypes } from '@sports-alliance/sports-lib';

export interface AppMyTracksSettings extends UserMyTracksSettingsInterface {
    is3D?: boolean;
    activityTypes?: ActivityTypes[];
}

export interface AppUserSettingsInterface extends UserSettingsInterface {
    myTracksSettings?: AppMyTracksSettings;
}

export interface AppUserInterface extends User {
    acceptedMarketingPolicy?: boolean;
    claimsUpdatedAt?: { seconds: number, nanoseconds: number } | Date;
    settings?: AppUserSettingsInterface;
}
