import { OWNER } from './definitions.mjs';
import { applyOwnedMonitoring } from '../monitoring/apply.mjs';
export const applyTrainingMonitoring = (bundle, request) => applyOwnedMonitoring(bundle, request, OWNER);
