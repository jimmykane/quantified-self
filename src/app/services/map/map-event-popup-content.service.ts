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
import { resolvePrimaryUnitAwareDisplayStat } from '../../helpers/summary-display.helper';
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
    const effortType = this.resolveEffortMetricType(event);
    return [
      this.resolveSummaryMetricFromEvent(event, DataDuration.type),
      this.resolveSummaryMetricFromEvent(event, DataDistance.type),
      this.resolveSummaryMetricFromEvent(event, effortType),
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

  private resolveEffortMetricType(event: EventInterface): string {
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

    const unitSettings = this.resolveUnitSettings();
    for (const statType of orderedTypes) {
      const stat = event.getStat?.(statType);
      const display = resolvePrimaryUnitAwareDisplayStat(stat, unitSettings, statType);
      if (display?.value) {
        return statType;
      }
    }

    return preferredType || DataSpeedAvg.type;
  }

  private resolveSummaryMetricFromEvent(event: EventInterface, statType: string): SummaryPrimaryInfoMetric {
    const stat = this.getEventSummaryStat(event, statType);
    const display = resolvePrimaryUnitAwareDisplayStat(stat, this.resolveUnitSettings(), statType);
    return {
      value: display?.value || '--',
      label: display?.unit || '',
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
}
