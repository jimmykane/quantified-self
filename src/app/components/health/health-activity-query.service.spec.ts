import { TestBed } from '@angular/core/testing';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFunctionsService } from '../../services/app.functions.service';
import { HealthActivityQueryService } from './health-activity-query.service';

describe('HealthActivityQueryService', () => {
  const functions = { call: vi.fn() };
  let service: HealthActivityQueryService;

  beforeEach(() => {
    functions.call.mockReset();
    TestBed.configureTestingModule({
      providers: [
        HealthActivityQueryService,
        { provide: AppFunctionsService, useValue: functions },
      ],
    });
    service = TestBed.inject(HealthActivityQueryService);
  });

  it('loads workout-backed Health observations through the bounded callable', async () => {
    const expected = {
      observations: [],
      complete: true,
      incompleteReason: null,
      candidateCount: 0,
      serializedBytes: 2,
    };
    functions.call.mockResolvedValue({ data: expected });
    const request = {
      metricId: HEALTH_METRIC_IDS.BodyWeight,
      startTimeMs: Date.parse('2026-01-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-01-31T23:59:59.999Z'),
    } as const;

    await expect(service.loadRange(request)).resolves.toBe(expected);
    expect(functions.call).toHaveBeenCalledWith('queryActivityHealthRange', request);
  });
});
