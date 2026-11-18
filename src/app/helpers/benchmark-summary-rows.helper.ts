import {
  type ActivityInterface, type DataInterface, DataDistance, DataFeeling, DataRPE, DynamicDataLoader,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings, resolveUnitAwareDisplayFromValue, resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
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
  value: string;
  delta: string;
}

interface BenchmarkSummaryCard {
  type: string;
  label: string;
  rows: BenchmarkSummaryRow[];
}

interface BenchmarkReading {
  stat: DataInterface;
  text: string;
}

function difference(reading: BenchmarkReading, reference: BenchmarkReading, settings: UserUnitSettingsInterface,
  sports: ActivityInterface['type'][]): string {
  const type = reading.stat.getType();
  const value = reading.stat.getValue();
  const base = reference.stat.getValue();
  if (typeof value !== 'number' || typeof base !== 'number' || type === DataFeeling.type || type === DataRPE.type) {
    return reading.text === reference.text ? 'Same' : 'Different';
  }
  const delta = value - base;
  if (!delta) return 'Same';
  // Subtract after unit conversion. Display-only units such as elevation retain canonical raw values.
  const magnitude = Math.abs(delta);
  const display = type === DataDistance.type
    ? resolvePrimaryUnitAwareDisplayStat(new DataDistance(magnitude), settings, type, sports)
    : resolveUnitAwareDisplayFromValue(type, magnitude, settings, { preferredType: type, stripRepeatedUnit: true });
  if (!display?.value) return 'Difference unavailable';
  // A real sub-precision difference can round to zero in the preferred unit.
  if (/0/.test(display.value) && !/[1-9]/.test(display.value)) return `≈${display.text}`;
  return `${delta > 0 ? '+' : '−'}${display.text}`;
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
        readings.set(source.value, { stat: unitStat, text: display.text });
      }
    }
    cards.set(type, [...variants].map(([displayType, readings]) => {
      const reference = readings.get(referenceKey);
      const sample = readings.values().next().value!;
      const rows = sources.map(source => {
        const reading = readings.get(source.value);
        let delta = '';
        if (sources.length > 1 && reading) {
          if (source.value === referenceKey) delta = 'Reference';
          else if (!reference) delta = 'No reference reading';
          else delta = difference(reading, reference, settings, sports);
        }
        return { key: source.value, label: source.label, color: source.color, value: reading?.text ?? 'Not recorded', delta };
      });
      return { type: displayType, label: RR_STAT_LABELS[type] ?? normalizeUnitDerivedStatLabel(sample.stat, { manufacturer }), rows };
    }));
  }
  return cards;
}
