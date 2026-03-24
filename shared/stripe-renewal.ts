export type UpcomingRenewalAmountResult =
    | {
        status: 'ready';
        amountMinor: number;
        currency: string;
    }
    | {
        status: 'no_upcoming_charge';
    }
    | {
        status: 'unavailable';
    };
