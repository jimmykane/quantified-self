import { EventInterface } from '@sports-alliance/sports-lib';

export interface OriginalFileMetaData {
    path: string;
    bucket?: string;
    startDate: Date;
    originalFilename?: string;
}

export interface AppEventInterface extends EventInterface {
    originalFile?: OriginalFileMetaData;
    originalFiles?: OriginalFileMetaData[];
}
