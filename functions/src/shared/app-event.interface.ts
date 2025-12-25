import { EventInterface } from '@sports-alliance/sports-lib';

export interface AppEventInterface extends EventInterface {
    originalFile?: {
        path: string;
        bucket?: string;
    };
    originalFiles?: {
        path: string;
        bucket?: string;
        startDate?: Date;  // Original activity start date (for merged events)
    }[];
}
