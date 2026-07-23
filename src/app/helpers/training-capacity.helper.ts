import type {
  DashboardTrainingCapacityContext,
  DashboardTrainingCapacityImportedMetric,
} from './dashboard-derived-metrics.helper';

export type TrainingCapacityInterpretationTone = 'positive' | 'neutral' | 'caution';

export interface TrainingCapacityMarkerViewModel {
  label: string;
  valueText: string;
  detailText: string;
}

export interface TrainingCapacityInterpretationViewModel {
  title: string;
  description: string;
  tone: TrainingCapacityInterpretationTone;
}

export interface TrainingCapacityDisciplineViewModel {
  discipline: 'running' | 'cycling';
  label: string;
  ftpSetting: TrainingCapacityMarkerViewModel | null;
  modeledCriticalPower: TrainingCapacityMarkerViewModel;
  importedVo2Max: TrainingCapacityMarkerViewModel | null;
  interpretation: TrainingCapacityInterpretationViewModel;
  evidenceText: string;
  nextStepText: string | null;
}

const FTP_ALIGNMENT_TOLERANCE = 0.05;

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

function buildModeledCriticalPower(
  discipline: DashboardTrainingCapacityContext['disciplines'][number],
): TrainingCapacityMarkerViewModel {
  const model = discipline.modeledCriticalPower;
  if (model.status === 'ready' && model.valueWatts !== null) {
    const relativePower = model.valueWattsPerKg !== null
      ? ` · ${formatNumber(model.valueWattsPerKg, 2)} W/kg`
      : '';
    const fitQuality = model.confidence === 'high' ? 'Strong model fit' : 'Moderate model fit';
    const effortCount = `${formatNumber(model.sourceEventCount)} power ${model.sourceEventCount === 1 ? 'workout' : 'workouts'} in window`;
    return {
      label: 'Modeled critical power',
      valueText: `${formatNumber(model.valueWatts)} W${relativePower}`,
      detailText: `Best recorded 3–20 min efforts · last 90 days · ${fitQuality} · ${effortCount}`,
    };
  }
  if (model.status === 'poor-fit') {
    return {
      label: 'Modeled critical power',
      valueText: 'Not modeled',
      detailText: 'Recent 3–20 min power efforts do not form a reliable critical-power model yet.',
    };
  }
  return {
    label: 'Modeled critical power',
    valueText: 'Not enough evidence',
    detailText: 'Record hard efforts across the 3–20 min range to build a reliable 90-day model.',
  };
}

function buildInterpretation(
  discipline: DashboardTrainingCapacityContext['disciplines'][number],
): TrainingCapacityInterpretationViewModel {
  const ftp = discipline.ftpSetting?.value ?? null;
  const model = discipline.modeledCriticalPower;
  const modeledPower = model.status === 'ready' ? model.valueWatts : null;
  if (ftp !== null && modeledPower !== null) {
    const relativeDifference = (modeledPower - ftp) / ftp;
    if (relativeDifference > FTP_ALIGNMENT_TOLERANCE) {
      return {
        title: 'Your FTP setting may be conservative',
        description: 'The 90-day model sits above the imported setting. Review the recent curve before using FTP for zones or workout targets.',
        tone: 'positive',
      };
    }
    if (relativeDifference < -FTP_ALIGNMENT_TOLERANCE) {
      return {
        title: 'Recent efforts have not validated this FTP yet',
        description: 'The 90-day model sits below the imported setting, but this does not show that fitness declined. The curve may simply lack recent maximal efforts across the required durations.',
        tone: 'caution',
      };
    }
    return {
      title: 'Recent power supports your FTP setting',
      description: 'The imported setting and the 90-day performance model are within 5%. Keep the setting if workouts and perceived effort also feel appropriate.',
      tone: 'positive',
    };
  }
  if (ftp !== null) {
    return {
      title: 'FTP is an imported setting, not a new estimate',
      description: 'We will compare it with recent performance after enough hard 3–20 minute efforts are available.',
      tone: 'neutral',
    };
  }
  if (modeledPower !== null) {
    return {
      title: 'Recent power can stand on its own',
      description: 'The model summarizes your best recorded 3–20 minute efforts. Add or update an FTP setting only if you use FTP-based zones and targets.',
      tone: 'neutral',
    };
  }
  if (discipline.importedVo2Max) {
    return {
      title: 'Only an imported aerobic marker is available',
      description: 'VO₂ max and power thresholds answer different questions, so this value is shown without comparing it with FTP or critical power.',
      tone: 'neutral',
    };
  }
  return {
    title: 'No capacity evidence yet',
    description: 'Import a source with FTP or VO₂ max, or record power efforts across 3–20 minutes to build a recent-performance model.',
    tone: 'neutral',
  };
}

function buildEvidenceText(
  discipline: DashboardTrainingCapacityContext['disciplines'][number],
): string {
  const model = discipline.modeledCriticalPower;
  if (model.status === 'ready') {
    const fit = model.confidence === 'high' ? 'strong' : 'moderate';
    return `Evidence quality: ${fit} — ${formatNumber(model.sourceEventCount)} power ${model.sourceEventCount === 1 ? 'workout' : 'workouts'} across the 3–20 minute model range.`;
  }
  if (model.status === 'poor-fit') {
    return 'Evidence quality: limited — recent 3–20 minute efforts do not form a stable power model.';
  }
  if (discipline.ftpSetting) {
    return 'Evidence quality: imported FTP setting only — there is not enough recent power evidence to compare it yet.';
  }
  if (discipline.importedVo2Max) {
    return 'Evidence quality: imported aerobic marker only — it is not interchangeable with a power threshold.';
  }
  return 'Evidence quality: unavailable — no imported marker or reliable recent power model is available yet.';
}

function buildNextStepText(
  discipline: DashboardTrainingCapacityContext['disciplines'][number],
): string | null {
  const ftp = discipline.ftpSetting?.value ?? null;
  const model = discipline.modeledCriticalPower;
  if (ftp === null || model.status !== 'ready' || model.valueWatts === null) {
    return null;
  }
  const relativeDifference = Math.abs((model.valueWatts - ftp) / ftp);
  return relativeDifference > FTP_ALIGNMENT_TOLERANCE
    ? 'Look at the recent 3–20 minute power curve before changing FTP-based zones or targets.'
    : null;
}

export function buildTrainingCapacityViewModels(
  context: DashboardTrainingCapacityContext | null,
): TrainingCapacityDisciplineViewModel[] {
  return (context?.disciplines || []).map((discipline) => ({
    discipline: discipline.discipline,
    label: discipline.discipline === 'running' ? 'Running' : 'Cycling',
    ftpSetting: buildImportedMarker(discipline.ftpSetting, 'FTP setting', ' W', 0),
    modeledCriticalPower: buildModeledCriticalPower(discipline),
    importedVo2Max: buildImportedMarker(discipline.importedVo2Max, 'Imported VO₂ max', ' ml/kg/min', 1),
    interpretation: buildInterpretation(discipline),
    evidenceText: buildEvidenceText(discipline),
    nextStepText: buildNextStepText(discipline),
  }));
}
