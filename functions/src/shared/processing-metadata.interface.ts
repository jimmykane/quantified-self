export type ProcessingEntity = 'event' | 'route';

export const EVENT_PROCESSING_ENTITY: ProcessingEntity = 'event';
export const ROUTE_PROCESSING_ENTITY: ProcessingEntity = 'route';

export interface ProcessingMetaData {
    processingEntity?: ProcessingEntity;
    sportsLibVersion: string;
    sportsLibVersionCode: number;
    processedAt: unknown;
}
