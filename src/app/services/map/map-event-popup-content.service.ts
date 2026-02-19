import { Injectable } from '@angular/core';
import {
  ActivityTypes,
  DataDistance,
  DataDuration,
  DataPaceAvg,
  DataSpeedAvg,
  DataSwimPaceAvg,
  EventInterface,
} from '@sports-alliance/sports-lib';
import { SummaryPrimaryInfoMetric } from '../../components/shared/summary-primary-info/summary-primary-info.component';
import { AppUserSettingsQueryService } from '../app.user-settings-query.service';
import { buildHeroMetric, resolvePrimaryUnitAwareDisplayStat } from '../../helpers/summary-display.helper';
import {
  resolvePreferredSpeedDerivedAverageTypeForActivity,
  resolvePreferredSpeedDerivedAverageTypesForActivity
} from '../../helpers/summary-stats.helper';

export interface MapEventPopupContent {
  eventType: string;
  iconEventType: string;
  startDate: number | Date | null | undefined;
  metrics: SummaryPrimaryInfoMetric[];
}

@Injectable({
  providedIn: 'root',
})
export class MapEventPopupContentService {
  constructor(private userSettingsQuery: AppUserSettingsQueryService) { }

  public buildFromEvent(event: EventInterface | null | undefined): MapEventPopupContent {
    if (!event) {
      return {
        eventType: 'Activity',
        iconEventType: 'Other',
        startDate: null,
        metrics: this.fallbackMetrics(),
      };
    }

    return {
      eventType: this.resolveEventTypeLabel(event),
      iconEventType: this.resolveIconEventType(event),
      startDate: event.startDate,
      metrics: this.buildMetricsFromEvent(event),
    };
  }

  private buildMetricsFromEvent(event: EventInterface): SummaryPrimaryInfoMetric[] {
    const unitSettings = this.resolveUnitSettings();
    return [
      buildHeroMetric(DataDuration.type, this.getEventSummaryStat(event, DataDuration.type), unitSettings),
      this.resolveSummaryMetricFromEvent(event, DataDistance.type),
      this.resolveEffortMetricFromEvent(event),
    ];
  }

  private fallbackMetrics(): SummaryPrimaryInfoMetric[] {
    return [{ value: '--', label: '' }, { value: '--', label: '' }, { value: '--', label: '' }];
  }

  private resolveEventTypeLabel(event: EventInterface): string {
    const displayType = event.getActivityTypesAsString?.();
    if (typeof displayType === 'string' && displayType.trim().length > 0) {
      return displayType.trim();
    }

    const types = event.getActivityTypesAsArray?.() || [];
    if (types.length > 1) {
      return 'Multisport';
    }
    if (types.length === 1) {
      const onlyType = types[0];
      if (typeof onlyType === 'string' && onlyType.trim().length > 0) {
        return onlyType.trim();
      }
      if (typeof onlyType === 'number' && Number.isFinite(onlyType) && ActivityTypes[onlyType]) {
        return String(ActivityTypes[onlyType]);
      }
    }

    return 'Activity';
  }

  private resolveIconEventType(event: EventInterface): string {
    const types = event.getActivityTypesAsArray?.() || [];
    if (types.length === 1) {
      const type = types[0];
      if (typeof type === 'string' && type.trim().length > 0) {
        return type.trim();
      }
      if (typeof type === 'number' && Number.isFinite(type) && ActivityTypes[type]) {
        return String(ActivityTypes[type]);
      }
    }

    if (types.length > 1) {
      return 'Multisport';
    }

    const displayType = event.getActivityTypesAsString?.();
    if (typeof displayType === 'string' && displayType.trim().length > 0) {
      return displayType.trim();
    }

    return 'Other';
  }

  private resolveEffortMetricFromEvent(event: EventInterface): SummaryPrimaryInfoMetric {
    const primaryActivityType = (event.getActivityTypesAsArray?.() || [])[0];
    const preferredType = resolvePreferredSpeedDerivedAverageTypeForActivity(primaryActivityType as any);
    const candidateTypes = [
      preferredType,
      ...resolvePreferredSpeedDerivedAverageTypesForActivity(primaryActivityType as any),
      DataSpeedAvg.type,
      DataPaceAvg.type,
      DataSwimPaceAvg.type,
    ].filter((type): type is string => typeof type === 'string' && type.length > 0);
    const orderedTypes = [...new Set(candidateTypes).values()];

    for (const statType of orderedTypes) {
      const metric = this.resolveSummaryMetricFromEvent(event, statType);
      if (metric.value !== '--') {
        return metric;
      }
    }

    return { value: '--', label: '' };
  }

  private resolveSummaryMetricFromEvent(event: EventInterface, statType: string): SummaryPrimaryInfoMetric {
    const stat = this.getEventSummaryStat(event, statType);
    const display = resolvePrimaryUnitAwareDisplayStat(stat, this.resolveUnitSettings(), statType);
    const convertedValue = this.toDisplayString(display?.value);
    const convertedUnit = this.toDisplayString(display?.unit);
    if (this.hasMeaningfulDisplayValue(convertedValue)) {
      return {
        value: convertedValue,
        label: convertedUnit,
      };
    }

    const fallbackMetric = this.resolveMetricFromRawStat(stat);
    if (fallbackMetric.value !== '--') {
      return fallbackMetric;
    }

    return {
      value: '--',
      label: '',
    };
  }

  private resolveMetricFromRawStat(stat: any): SummaryPrimaryInfoMetric {
    const fallbackValue = this.toDisplayString(stat?.getDisplayValue?.());
    const fallbackUnit = this.toDisplayString(stat?.getDisplayUnit?.());
    if (this.hasMeaningfulDisplayValue(fallbackValue)) {
      return {
        value: fallbackValue,
        label: fallbackUnit,
      };
    }

    return {
      value: '--',
      label: '',
    };
  }

  private getEventSummaryStat(event: EventInterface, statType: string): any {
    if (statType === DataDuration.type && typeof event.getDuration === 'function') {
      return event.getDuration();
    }
    if (statType === DataDistance.type && typeof event.getDistance === 'function') {
      return event.getDistance();
    }
    if (typeof event.getStat === 'function') {
      return event.getStat(statType);
    }
    return null;
  }

  private resolveUnitSettings(): any {
    if (typeof this.userSettingsQuery.unitSettings === 'function') {
      return this.userSettingsQuery.unitSettings();
    }
    return undefined;
  }

  private toDisplayString(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value);
  }

  private hasMeaningfulDisplayValue(value: string | null | undefined): boolean {
    if (typeof value !== 'string') {
      return false;
    }

    const normalized = value.trim();
    if (!normalized) {
      return false;
    }

    const normalizedLower = normalized.toLowerCase();
    if (normalized === '--' || normalized === '-' || normalizedLower === 'n/a' || normalizedLower === 'na') {
      return false;
    }

    return true;
  }
}
