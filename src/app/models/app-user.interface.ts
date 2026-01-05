import { User } from '@sports-alliance/sports-lib';

export interface AppUserInterface extends User {
    acceptedMarketingPolicy?: boolean;
    claimsUpdatedAt?: { seconds: number, nanoseconds: number } | Date;
}
