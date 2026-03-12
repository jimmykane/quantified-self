import { Timestamp } from '@angular/fire/firestore';

export interface AppFirestoreTimestampLike {
    seconds: number;
    nanoseconds?: number;
}

export interface AppDateLike {
    toDate: () => Date;
}

export type AppDateValue = Timestamp | Date | string | number | AppFirestoreTimestampLike | AppDateLike;
