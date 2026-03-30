import { Timestamp } from 'app/firebase/firestore';

export interface AppFirestoreTimestampLike {
    seconds: number;
    nanoseconds?: number;
}

export interface AppDateLike {
    toDate: () => Date;
}

export type AppDateValue = Timestamp | Date | string | number | AppFirestoreTimestampLike | AppDateLike;
