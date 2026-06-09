export type ProcessingEntity = 'event' | 'route';

export interface ProcessingMetaData {
    processingEntity?: ProcessingEntity;
    sportsLibVersion: string;
    sportsLibVersionCode: number;
    processedAt: unknown;
}
