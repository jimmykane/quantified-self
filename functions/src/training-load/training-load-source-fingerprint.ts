import { createHash } from 'node:crypto';
import { serializeTrainingLoadSource } from '../../../shared/training-load-source';

// Source coordination must not load the calculation registry just to ignore a write.
export const trainingLoadSourceFingerprint = (data: Parameters<typeof serializeTrainingLoadSource>[0]): string =>
  createHash('sha256').update(serializeTrainingLoadSource(data)).digest('hex');
export const trainingLoadWriteTime = (time: { seconds: number; nanoseconds: number } | undefined): string =>
  time ? `${time.seconds}:${time.nanoseconds}` : '';
