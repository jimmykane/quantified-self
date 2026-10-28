import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { logGarminTrainingRequestFailure, logGarminTrainingResponse } from './diagnostics';
import { GarminTrainingHttpError } from './http';

describe('Garmin response diagnostics', () => {
  beforeEach(() => { vi.mocked(logger.info).mockClear(); vi.mocked(logger.warn).mockClear(); });
  it('logs only fixed field shapes, never provider contents or request identity', () => {
    logGarminTrainingResponse({ method: 'POST', path: '/training-api/schedule/', body: 'private-request' }, { status: 200,
      body: { scheduleId: 'private-id', workoutId: 987654321, ownerId: { secret: 'private-owner' }, date: 'private-date',
        'private-field-name': 'private-payload' } });
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', { event: 'garmin_response', provider: 'garmin',
      method: 'POST', resource: 'schedule', httpStatus: 200, responseShape: 'object', scheduleIdShape: 'string',
      workoutIdShape: 'number', ownerIdShape: 'object', dateShape: 'string' });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toMatch(/private|987654321/);
  });
  it.each([[null, 'null'], [undefined, 'undefined'], [[], 'array'], ['private', 'string'], [true, 'boolean']])(
    'describes response shape without returning its value (%s)', (body, responseShape) => {
      logGarminTrainingResponse({ method: 'GET', path: '/training-api/schedule?startDate=private-date&endDate=private-date' }, { status: 200, body });
      expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', { event: 'garmin_response', provider: 'garmin',
        method: 'GET', resource: 'schedule-list', httpStatus: 200, responseShape });
      expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('private');
    });
  it('preserves safe HTTP failure context and discards raw error messages', () => {
    const request = { method: 'PUT' as const, path: '/training-api/workout/v2/987654321', body: 'private-body' };
    logGarminTrainingRequestFailure(request, new GarminTrainingHttpError('uncertain', false, 0, { httpStatus: 200, failurePhase: 'decode' }));
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', { event: 'garmin_request_incomplete', provider: 'garmin',
      method: 'PUT', resource: 'workout', category: 'uncertain', httpStatus: 200, failurePhase: 'decode' });
    logGarminTrainingRequestFailure(request, new Error('private-token-and-response'));
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toMatch(/private|987654321/);
  });
});
