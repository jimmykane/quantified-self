import { DataDuration, DataRecoveryTime } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  resolveLatestRecoveryNowContext,
  resolveRecoveryEventEndTimeMs,
  resolveRemainingRecoverySeconds,
} from './dashboard-recovery-now.helper';

function buildEvent(options: {
  startDate?: number;
  endDate?: number;
  recoverySeconds?: number;
  durationSeconds?: number;
  durationStatSeconds?: number;
}): any {
  const startDate = options.startDate !== undefined ? new Date(options.startDate) : undefined;
  const endDate = options.endDate !== undefined ? new Date(options.endDate) : undefined;
  const recoveryStat = options.recoverySeconds !== undefined
    ? { getValue: () => options.recoverySeconds }
    : null;
  const durationStat = options.durationStatSeconds !== undefined
    ? { getValue: () => options.durationStatSeconds }
    : null;

  return {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    getStat: (type: string) => {
      if (type === DataRecoveryTime.type) {
        return recoveryStat;
      }
      if (type === DataDuration.type) {
        return durationStat;
      }
      return null;
    },
    getDuration: () => (
      options.durationSeconds !== undefined
        ? { getValue: () => options.durationSeconds }
        : null
    ),
  };
}

describe('dashboard-recovery-now.helper', () => {
  it('resolves the latest valid recovery context from the event list', () => {
    const context = resolveLatestRecoveryNowContext([
      buildEvent({
        startDate: Date.UTC(2024, 0, 1, 9, 0, 0),
        endDate: Date.UTC(2024, 0, 1, 10, 0, 0),
        recoverySeconds: 1200,
      }),
      buildEvent({
        startDate: Date.UTC(2024, 0, 4, 9, 0, 0),
        endDate: Date.UTC(2024, 0, 4, 10, 0, 0),
      }),
      buildEvent({
        startDate: Date.UTC(2024, 0, 3, 9, 0, 0),
        endDate: Date.UTC(2024, 0, 3, 10, 0, 0),
        recoverySeconds: 5400,
      }),
    ] as any);

    expect(context).toEqual({
      totalSeconds: 5400,
      endTimeMs: Date.UTC(2024, 0, 3, 10, 0, 0),
    });
  });

  it('resolves event end time from duration fallback when endDate is missing', () => {
    const startTime = Date.UTC(2024, 0, 10, 8, 0, 0);
    const endTimeMs = resolveRecoveryEventEndTimeMs(buildEvent({
      startDate: startTime,
      durationSeconds: 1800,
      recoverySeconds: 2400,
    }) as any);

    expect(endTimeMs).toBe(startTime + (1800 * 1000));
  });

  it('resolves event end time from duration stat fallback when getDuration is unavailable', () => {
    const startTime = Date.UTC(2024, 0, 10, 8, 0, 0);
    const endTimeMs = resolveRecoveryEventEndTimeMs(buildEvent({
      startDate: startTime,
      durationStatSeconds: 2700,
      recoverySeconds: 2400,
    }) as any);

    expect(endTimeMs).toBe(startTime + (2700 * 1000));
  });

  it('computes remaining recovery with clamp-to-zero behavior', () => {
    const context = {
      totalSeconds: 3600,
      endTimeMs: 1_000_000,
    };

    expect(resolveRemainingRecoverySeconds(context, 1_900_000)).toBe(2700);
    expect(resolveRemainingRecoverySeconds(context, 4_700_000)).toBe(0);
  });

  it('returns null for invalid or missing recovery contexts', () => {
    expect(resolveLatestRecoveryNowContext(null)).toBeNull();
    expect(resolveLatestRecoveryNowContext([] as any)).toBeNull();
    expect(resolveLatestRecoveryNowContext([
      buildEvent({
        startDate: Date.UTC(2024, 0, 1, 9, 0, 0),
        endDate: Date.UTC(2024, 0, 1, 10, 0, 0),
        recoverySeconds: 0,
      }),
    ] as any)).toBeNull();

    expect(resolveRemainingRecoverySeconds(null)).toBeNull();
    expect(resolveRemainingRecoverySeconds({
      totalSeconds: NaN,
      endTimeMs: Date.UTC(2024, 0, 1, 10, 0, 0),
    })).toBeNull();
  });
});
