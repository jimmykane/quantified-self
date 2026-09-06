import { DataVO2Max, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import type {
  DashboardTrainingCapacityContext,
  DashboardTrainingCapacityImportedMetric,
  DashboardTrainingCapacityReferenceVo2Max,
} from './dashboard-derived-metrics.helper';

export interface TrainingCapacityMarkerViewModel {
  label: string;
  valueText: string;
  detailText: string;
}

export interface TrainingCapacityDisciplineViewModel {
  discipline: 'running' | 'cycling';
  label: string;
  ftpSetting: TrainingCapacityMarkerViewModel | null;
  importedVo2Max: TrainingCapacityMarkerViewModel | null;
  referenceVo2Max: TrainingCapacityMarkerViewModel | null;
  evidenceText: string;
}

function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDate(timeMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(timeMs));
}

function formatSource(sourceKey: string | null): string {
  if (!sourceKey) {
    return '';
  }
  return sourceKey
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function buildImportedMarkerDetail(metric: DashboardTrainingCapacityImportedMetric): string {
  const formattedSource = formatSource(metric.sourceKey);
  const sourceText = formattedSource ? `Imported from ${formattedSource}` : 'Imported with workout data';
  const observationText = metric.firstSeenAtMs === metric.lastSeenAtMs
    ? `seen ${formatDate(metric.lastSeenAtMs)}`
    : `unchanged since ${formatDate(metric.firstSeenAtMs)} · last seen ${formatDate(metric.lastSeenAtMs)}`;
  if (
    metric.previousValue !== null
    && metric.changePct !== null
    && metric.previousSourceKey === metric.sourceKey
  ) {
    const sign = metric.changePct > 0 ? '+' : '';
    return `${sourceText} · ${observationText} · previous ${formatNumber(metric.previousValue, 1)} (${sign}${formatNumber(metric.changePct, 1)}%)`;
  }
  return `${sourceText} · ${observationText}`;
}

function buildImportedMarker(
  metric: DashboardTrainingCapacityImportedMetric | null,
  label: string,
  suffix: string,
  fractionDigits: number,
): TrainingCapacityMarkerViewModel | null {
  return metric ? {
    label,
    valueText: `${formatNumber(metric.value, fractionDigits)}${suffix}`,
    detailText: buildImportedMarkerDetail(metric),
  } : null;
}

function formatVo2Max(
  value: number,
  unitSettings: UserUnitSettingsInterface | null | undefined,
): string {
  const data = new DataVO2Max(value);
  const display = resolveUnitAwareDisplayStat(data, unitSettings);
  return display?.text || `${data.getDisplayValue()} ${data.getDisplayUnit()}`;
}

function formatVo2MaxDelta(
  value: number,
  unitSettings: UserUnitSettingsInterface | null | undefined,
): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatVo2Max(Math.abs(value), unitSettings)}`;
}

function buildReferenceMarker(
  metric: DashboardTrainingCapacityReferenceVo2Max | null,
  unitSettings: UserUnitSettingsInterface | null | undefined,
): TrainingCapacityMarkerViewModel | null {
  if (!metric) return null;
  const method = metric.method === 'lab-test' ? 'Lab test' : 'Field test';
  const comparison = metric.comparison
    ? ` · nearest imported workout ${formatVo2Max(metric.comparison.value, unitSettings)} · reference difference ${formatVo2MaxDelta(metric.comparison.delta, unitSettings)} · ${formatNumber(metric.comparison.gapDays, 1)} days away`
    : ' · no nearby imported workout value to compare';
  return {
    label: `${method} VO₂ max`,
    valueText: formatVo2Max(metric.value, unitSettings),
    detailText: `Recorded ${formatDate(metric.observedAtMs)}${comparison}`,
  };
}

function buildEvidenceText(
  discipline: DashboardTrainingCapacityContext['disciplines'][number],
): string {
  if (discipline.referenceVo2Max && discipline.importedVo2Max) {
    return 'Manual test and imported workout VO₂ max are separate evidence. A comparison appears only when their dates are within 14 days.';
  }
  if (discipline.referenceVo2Max) {
    return 'The manual VO₂ max is a dated test reference, not a Quantified Self estimate.';
  }
  if (discipline.ftpSetting && discipline.importedVo2Max) {
    return 'Imported FTP and VO₂ max are source observations. They are shown separately and are not fitted or compared with each other.';
  }
  if (discipline.ftpSetting) {
    return 'FTP is an imported setting from workout data, not a new Quantified Self estimate.';
  }
  if (discipline.importedVo2Max) {
    return 'VO₂ max is an imported aerobic observation and is not interchangeable with a power threshold.';
  }
  return 'No imported FTP or VO₂ max observation is available for this sport.';
}

export function buildTrainingCapacityViewModels(
  context: DashboardTrainingCapacityContext | null,
  unitSettings?: UserUnitSettingsInterface | null,
): TrainingCapacityDisciplineViewModel[] {
  return (context?.disciplines || []).map((discipline) => ({
    discipline: discipline.discipline,
    label: discipline.discipline === 'running' ? 'Running' : 'Cycling',
    ftpSetting: buildImportedMarker(discipline.ftpSetting, 'FTP setting', ' W', 0),
    importedVo2Max: discipline.importedVo2Max ? {
      label: 'Imported VO₂ max',
      valueText: formatVo2Max(discipline.importedVo2Max.value, unitSettings),
      detailText: buildImportedMarkerDetail(discipline.importedVo2Max),
    } : null,
    referenceVo2Max: buildReferenceMarker(discipline.referenceVo2Max, unitSettings),
    evidenceText: buildEvidenceText(discipline),
  }));
}
