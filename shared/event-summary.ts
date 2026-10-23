import {
  ActivityTypesHelper, DataDeviceNames, DataDistance, DataDuration, EventSummary, DynamicDataLoader,
  type DataInterface, type DefaultDataValue, type EventSummaryJSONInterface,
} from '@sports-alliance/sports-lib/metrics';
import type { AppEventMetadata, EventRead } from './event-read';

let nextRevision = 0;

function multipliedNames(values: readonly string[]): string {
  const counts = new Map<string, number>();
  values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts].map(([value, count]) => count === 1 ? value : `${count}x ${value}`).join(', ');
}

export interface AppEventSummary extends AppEventMetadata {}

/** QS summary composition; deliberately has no toJSON, setID or child activity API. */
export class AppEventSummary implements EventRead {
  name: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  privacy: EventSummary['privacy'];
  isMerge: boolean;
  srcFileType: EventSummary['srcFileType'];
  private readonly sourceRevision = ++nextRevision;
  private metricRevision = 0;
  private readonly observed = new Map<string, { stat: DataInterface<unknown>; value: string | undefined; initialValue: string | undefined }>();
  private readonly summary: EventSummary;
  private readonly savedStats = new Map<string, DataInterface | undefined>();
  private readonly sourceStatsJSON: string;
  private readonly sourceType: unknown;

  constructor(json: EventSummaryJSONInterface, source: { stats?: unknown; type?: unknown } = json) {
    // Fingerprints describe persisted input, including aliases and fields excluded by display semantics.
    // Capture it once, before Sports Lib normalizes the read model; never serialize it per row render.
    this.sourceStatsJSON = JSON.stringify(source.stats ?? {});
    this.sourceType = source.type ?? null;
    this.summary = EventSummary.fromJSON(json);
    this.name = this.summary.name;
    this.description = this.summary.description;
    this.startDate = this.summary.startDate;
    this.endDate = this.summary.endDate;
    this.privacy = this.summary.privacy;
    this.isMerge = this.summary.isMerge;
    this.srcFileType = this.summary.srcFileType;
  }

  getID(): string | null { return this.summary.getID(); }

  getStat<TValue = DefaultDataValue>(type: string): DataInterface<TValue> | undefined {
    const stat = this.savedStats.has(type) ? this.savedStats.get(type) as DataInterface<TValue> | undefined : this.summary.getStat<TValue>(type);
    if (stat && !this.observed.has(stat.getType())) {
      const value = JSON.stringify(stat.getValue());
      this.observed.set(stat.getType(), { stat, value, initialValue: value });
    }
    return stat;
  }

  getDistance(): DataDistance | undefined { return this.getStat<number>(DataDistance.type) as DataDistance | undefined; }
  getDuration(): DataDuration | undefined { return this.getStat<number>(DataDuration.type) as DataDuration | undefined; }
  getActivityTypesAsArray(): string[] { return this.summary.getActivityTypesAsArray(); }

  getActivityTypesAsString(): string {
    const types = this.getActivityTypesAsArray();
    return multipliedNames(types.map(type => ActivityTypesHelper.resolveActivityType(type) || type));
  }

  getDeviceNamesAsString(): string {
    const names = this.getStat<string[]>(DataDeviceNames.type)?.getValue();
    return Array.isArray(names) ? multipliedNames(names) : '';
  }

  applySavedStat(type: string, value: number | null): void {
    this.savedStats.set(type, value === null ? undefined : DynamicDataLoader.getDataInstanceFromDataType(type, value));
    this.observed.delete(type);
    this.metricRevision++;
  }

  getSourceSnapshot() {
    const stats: EventSummaryJSONInterface['stats'] = JSON.parse(this.sourceStatsJSON);
    this.observed.forEach(({ stat, initialValue }, type) => {
      // Reading/normalizing a metric is not a source edit, and derived reads cannot add source fields.
      if (Object.prototype.hasOwnProperty.call(stats, type) && JSON.stringify(stat.getValue()) !== initialValue) {
        stats[type] = stat.getValue() as typeof stats[string];
      }
    });
    this.savedStats.forEach((stat, type) => {
      if (stat) stats[type] = stat.getValue();
      else delete stats[type];
    });
    return { startDate: +this.startDate, endDate: +this.endDate, type: this.sourceType, stats };
  }

  getReadRevision(_types: readonly string[]): string {
    for (const entry of this.observed.values()) {
      const value = JSON.stringify(entry.stat.getValue());
      if (value !== entry.value) {
        entry.value = value;
        this.metricRevision++;
      }
    }
    return `${this.sourceRevision}:${this.metricRevision}`;
  }
}
