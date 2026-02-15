import { ChangeDetectorRef, NgZone } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DashboardChartAbstractDirective } from './dashboard-chart-abstract-component.directive';
import { ChartDataValueTypes, DataDistance, DynamicDataLoader } from '@sports-alliance/sports-lib';
import { AmChartsService } from '../../services/am-charts.service';
import { LoggerService } from '../../services/logger.service';

class TestDashboardChartDirective extends DashboardChartAbstractDirective {
  constructor(
    private readonly loggerMock: Pick<LoggerService, 'warn'>
  ) {
    super(
      new NgZone({ enableLongStackTrace: false }),
      {} as ChangeDetectorRef,
      {} as AmChartsService,
      loggerMock as LoggerService
    );
  }

  protected async createChart(): Promise<any> {
    return {} as any;
  }

  public setDataType(dataType?: string): void {
    this.chartDataType = dataType;
  }

  public getDataInstanceForTest(value: unknown): any {
    return this.getDataInstanceOrNull(value);
  }

  public getAggregateForTest(data: any[], valueType: ChartDataValueTypes): any {
    return this.getAggregateData(data, valueType);
  }
}

describe('DashboardChartAbstractDirective', () => {
  let loggerMock: { warn: ReturnType<typeof vi.fn> };
  let directive: TestDashboardChartDirective;

  beforeEach(() => {
    loggerMock = {
      warn: vi.fn(),
    };
    directive = new TestDashboardChartDirective(loggerMock);
    directive.setDataType(DataDistance.type);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null without calling loader for non numeric values', () => {
    const loaderSpy = vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType');

    expect(directive.getDataInstanceForTest(undefined)).toBeNull();
    expect(directive.getDataInstanceForTest(null)).toBeNull();
    expect(directive.getDataInstanceForTest('abc')).toBeNull();
    expect(loaderSpy).not.toHaveBeenCalled();
  });

  it('should return null and warn when data loader throws', () => {
    vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockImplementation(() => {
      throw new Error('loader-failed');
    });

    const result = directive.getDataInstanceForTest(42);

    expect(result).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('should aggregate average values and return formatted data instance', () => {
    vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockImplementation((_type: string, value: number) => {
      return {
        getDisplayValue: () => String(value),
        getDisplayUnit: () => 'km',
        getType: () => DataDistance.type,
        getDisplayType: () => 'Distance',
      } as any;
    });

    const result = directive.getAggregateForTest([
      { [ChartDataValueTypes.Average]: 10 },
      { [ChartDataValueTypes.Average]: 20 },
      { [ChartDataValueTypes.Average]: 30 },
    ], ChartDataValueTypes.Average);

    expect(result).toBeTruthy();
    expect(result.getDisplayValue()).toBe('20');
    expect(result.getDisplayUnit()).toBe('km');
  });

  it('should return null when aggregate data has no finite values', () => {
    const loaderSpy = vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType');

    const result = directive.getAggregateForTest([
      { [ChartDataValueTypes.Total]: undefined },
      { [ChartDataValueTypes.Total]: 'NaN' },
    ], ChartDataValueTypes.Total);

    expect(result).toBeNull();
    expect(loaderSpy).not.toHaveBeenCalled();
  });
});
