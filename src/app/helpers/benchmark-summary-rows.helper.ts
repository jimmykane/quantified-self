import {
  type ActivityInterface, type DataInterface, DataDistance, DataDuration, DataFeeling, DataRPE, DynamicDataLoader,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import {
  normalizeUserUnitSettings, resolveUnitAwareDisplayFromValue, resolveUnitAwareDisplayStat, type UnitAwareStatDisplay,
} from '@shared/unit-aware-display';
import { getCommonMetricManufacturer } from '@shared/endurance-metrics';
import { RR_STAT_LABELS } from '../constants/rr-metrics';
import { getBenchmarkRRLabels } from './benchmark-rr.helper';
import { normalizeUnitDerivedStatLabel } from './stat-label.helper';
import { resolvePrimaryUnitAwareDisplayStat, resolveSummaryDisplayStat } from './summary-display.helper';

export interface BenchmarkSummarySource {
  value: string;
  label: string;
  color: string;
  activity: ActivityInterface;
  stats: Map<string, DataInterface>;
}

export function getBenchmarkSummarySources(all: ActivityInterface[], selected: ActivityInterface[], types: string[],
  colorFor: (activity: ActivityInterface) => string): BenchmarkSummarySource[] {
  const labels = getBenchmarkRRLabels(all);
  const ids = all.map(activity => activity.getID());
  const selectedIds = new Set(selected.map(activity => activity.getID()));
  const metricTypes = new Set(types);
  return all.flatMap((activity, index) => {
    const id = ids[index];
    const uniqueId = !!id && ids.indexOf(id) === ids.lastIndexOf(id);
    if (!selected.includes(activity) && !(uniqueId && selectedIds.has(id))) return [];
    const stats = new Map<string, DataInterface>();
    for (const type of metricTypes) {
      const stat = activity.getStat(type);
      const raw = stat && stat.getValue();
      if (stat && raw != null && (typeof raw !== 'number' || Number.isFinite(raw)) && stat.isValueTypeValid(raw)) {
        stats.set(type, stat);
      }
    }
    return [{ value: uniqueId ? `id:${id}` : `index:${index}`, label: labels[index], color: colorFor(activity), activity, stats }];
  });
}

interface BenchmarkSummaryRow {
  key: string;
  label: string;
  color: string;
  value: string | null;
  delta: string;
}

interface BenchmarkSummaryCard {
  type: string;
  label: string;
  hasReferenceReading: boolean;
  range: string | null;
  rows: BenchmarkSummaryRow[];
}

interface BenchmarkReading {
  stat: DataInterface;
  display: UnitAwareStatDisplay;
}

function difference(reading: BenchmarkReading, reference: BenchmarkReading, settings: UserUnitSettingsInterface,
  sports: ActivityInterface['type'][]): string {
  const type = reading.stat.getType();
  const value = reading.stat.getValue();
  const base = reference.stat.getValue();
  if (typeof value !== 'number' || typeof base !== 'number' || type === DataFeeling.type || type === DataRPE.type) {
    return reading.display.text === reference.display.text ? 'Same' : 'Different';
  }
  const delta = value - base;
  if (!delta) return 'Same';
  // Subtract after unit conversion. Display-only units such as elevation retain canonical raw values.
  const magnitude = Math.abs(delta);
  const sign = delta > 0 ? '+' : '−';
  if (reading.stat instanceof DataDuration && magnitude < 1) {
    // The converted pace already carries seconds per preferred distance unit.
    const stat = DynamicDataLoader.getDataInstanceFromDataType(type, magnitude);
    if (stat instanceof DataDuration) {
      const time = stat.getStopwatchDisplayValue(2);
      if (/[1-9]/.test(time)) return `${sign}${time} ${stat.getDisplayUnit()}`.trim();
    }
  }
  const display = type === DataDistance.type
    ? resolvePrimaryUnitAwareDisplayStat(new DataDistance(magnitude), settings, type, sports)
    : resolveUnitAwareDisplayFromValue(type, magnitude, settings, { preferredType: type, stripRepeatedUnit: true });
  if (!display?.value) return 'Difference unavailable';
  // A real sub-precision difference can round to zero in the preferred unit.
  if (/0/.test(display.value) && !/[1-9]/.test(display.value)) return delta > 0 ? 'Slightly higher' : 'Slightly lower';
  return `${sign}${display.text}`;
}

function formatRangeEndpoint(reading: BenchmarkReading): string {
  const { stat, display } = reading;
  // Keep duration ranges on a single compact line using Sports Lib's clock format.
  return stat instanceof DataDuration && !display.unit
    ? stat.getDisplayValue(false, true, false, true)
    : display.value;
}

function formatReadingRange(readings: ReadonlyMap<string, BenchmarkReading>, first: BenchmarkReading): string | null {
  const firstValue = first.stat.getValue();
  if (typeof firstValue !== 'number' || first.stat instanceof DataFeeling || first.stat instanceof DataRPE) {
    return [...readings.values()].every(reading => reading.display.text === first.display.text)
      ? first.display.text : null;
  }

  let min = first;
  let max = first;
  let minValue = firstValue;
  let maxValue = firstValue;
  for (const reading of readings.values()) {
    const value = reading.stat.getValue();
    if (typeof value !== 'number') continue;
    if (value < minValue) {
      min = reading;
      minValue = value;
    }
    if (value > maxValue) {
      max = reading;
      maxValue = value;
    }
  }

  const low = formatRangeEndpoint(min);
  const high = formatRangeEndpoint(max);
  const unit = max.display.unit;
  if (min.display.unit !== unit) return `${min.display.text}–${max.display.text}`;
  return `${low === high ? high : `${low}–${high}`} ${unit}`.trim();
}

export function buildBenchmarkSummaryCards(sources: BenchmarkSummarySource[], referenceKey: string, units: UserUnitSettingsInterface) {
  const settings = normalizeUserUnitSettings(units);
  const sports = sources.map(source => source.activity.type);
  const manufacturer = getCommonMetricManufacturer(sources.map(source => source.activity));
  const types = new Set(sources.flatMap(source => [...source.stats.keys()]));
  const cards = new Map<string, BenchmarkSummaryCard[]>();
  for (const type of types) {
    const variants = new Map<string, Map<string, BenchmarkReading>>();
    for (const source of sources) {
      const stat = resolveSummaryDisplayStat(source.stats.get(type), type, sports, settings);
      if (!stat) continue;
      for (const unitStat of DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, settings)) {
        const display = resolveUnitAwareDisplayStat(unitStat, null, { stripRepeatedUnit: true });
        if (!display?.value) continue;
        let readings = variants.get(display.type);
        if (!readings) {
          readings = new Map();
          variants.set(display.type, readings);
        }
        readings.set(source.value, { stat: unitStat, display });
      }
    }
    cards.set(type, [...variants].map(([displayType, readings]) => {
      const reference = readings.get(referenceKey);
      const sample = readings.values().next().value!;
      const rows = sources.map(source => {
        const reading = readings.get(source.value);
        let delta = '';
        if (sources.length > 1 && reading && reference) {
          delta = source.value === referenceKey ? 'Reference' : difference(reading, reference, settings, sports);
        }
        return { key: source.value, label: source.label, color: source.color, value: reading?.display.text ?? null, delta };
      });
      const label = RR_STAT_LABELS[type] ?? normalizeUnitDerivedStatLabel(sample.stat, { manufacturer });
      const unit = sample.stat.getDisplayUnit();
      return {
        type: displayType,
        hasReferenceReading: !!reference,
        label: variants.size > 1 && unit ? `${label} (${unit})` : label,
        range: formatReadingRange(readings, sample),
        rows,
      };
    }));
  }
  return cards;
}
