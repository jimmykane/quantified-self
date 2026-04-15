import { DataDuration, DataRecoveryTime } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  resolveActiveRecoveryTotalSeconds,
  resolveAggregatedRecoveryNowContext,
  resolveLatestWorkoutRecoverySeconds,
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
  it('resolves aggregated recovery context from all valid events in the list', () => {
    const context = resolveAggregatedRecoveryNowContext([
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
      totalSeconds: 6600,
      endTimeMs: Date.UTC(2024, 0, 3, 10, 0, 0),
      segments: [
        {
          totalSeconds: 1200,
          endTimeMs: Date.UTC(2024, 0, 1, 10, 0, 0),
        },
        {
          totalSeconds: 5400,
          endTimeMs: Date.UTC(2024, 0, 3, 10, 0, 0),
        },
      ],
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

  it('computes remaining recovery with clamp-to-zero behavior for a single recovery window', () => {
    const context = {
      totalSeconds: 3600,
      endTimeMs: 1_000_000,
    };

    expect(resolveRemainingRecoverySeconds(context, 1_900_000)).toBe(2700);
    expect(resolveRemainingRecoverySeconds(context, 4_700_000)).toBe(0);
  });

  it('computes summed remaining recovery across multiple recovery windows', () => {
    const context = {
      totalSeconds: 7200,
      endTimeMs: 2_000_000,
      segments: [
        {
          totalSeconds: 3600,
          endTimeMs: 1_000_000,
        },
        {
          totalSeconds: 3600,
          endTimeMs: 2_000_000,
        },
      ],
    };

    expect(resolveRemainingRecoverySeconds(context, 2_800_000)).toBe(4600);
    expect(resolveRemainingRecoverySeconds(context, 8_000_000)).toBe(0);
  });

  it('resolves active total recovery from currently active segments only', () => {
    const context = {
      totalSeconds: 7200,
      endTimeMs: 2_000_000,
      segments: [
        { totalSeconds: 3600, endTimeMs: 1_000_000 },
        { totalSeconds: 7200, endTimeMs: 2_000_000 },
      ],
    };

    expect(resolveActiveRecoveryTotalSeconds(context, 1_500_000)).toBe(10800);
    expect(resolveActiveRecoveryTotalSeconds(context, 5_000_000)).toBe(7200);
    expect(resolveActiveRecoveryTotalSeconds(context, 12_000_000)).toBe(0);
  });

  it('resolves latest workout recovery from metadata and segment fallback', () => {
    expect(resolveLatestWorkoutRecoverySeconds({
      totalSeconds: 3600,
      endTimeMs: 1_000,
      latestWorkoutSeconds: 5400,
      latestWorkoutEndTimeMs: 2_000,
    })).toBe(5400);

    expect(resolveLatestWorkoutRecoverySeconds({
      totalSeconds: 3600,
      endTimeMs: 2_000,
      segments: [
        { totalSeconds: 1200, endTimeMs: 1_000 },
        { totalSeconds: 4800, endTimeMs: 2_000 },
      ],
    })).toBe(4800);
  });

  it('returns null for invalid or missing recovery contexts', () => {
    expect(resolveAggregatedRecoveryNowContext(null)).toBeNull();
    expect(resolveAggregatedRecoveryNowContext([] as any)).toBeNull();
    expect(resolveAggregatedRecoveryNowContext([
      buildEvent({
        startDate: Date.UTC(2024, 0, 1, 9, 0, 0),
        endDate: Date.UTC(2024, 0, 1, 10, 0, 0),
        recoverySeconds: 15 * 24 * 60 * 60,
      }),
    ] as any)).toBeNull();

    expect(resolveRemainingRecoverySeconds(null)).toBeNull();
    expect(resolveRemainingRecoverySeconds({
      totalSeconds: NaN,
      endTimeMs: Date.UTC(2024, 0, 1, 10, 0, 0),
    })).toBeNull();
    expect(resolveLatestWorkoutRecoverySeconds(null)).toBeNull();
  });

  it('keeps legacy latest helper as a compatibility alias to aggregated behavior', () => {
    const events = [
      buildEvent({
        startDate: Date.UTC(2024, 0, 1, 9, 0, 0),
        endDate: Date.UTC(2024, 0, 1, 10, 0, 0),
        recoverySeconds: 1200,
      }),
      buildEvent({
        startDate: Date.UTC(2024, 0, 2, 9, 0, 0),
        endDate: Date.UTC(2024, 0, 2, 10, 0, 0),
        recoverySeconds: 1800,
      }),
    ] as any;

    expect(resolveLatestRecoveryNowContext(events)).toEqual(
      resolveAggregatedRecoveryNowContext(events),
    );
  });
});
