import {
  ChartDataValueTypes,
  DataAerobicTrainingEffect,
  DataAnaerobicTrainingEffect,
  DataAscent,
  DataAvgVAM,
  DataCadenceAvg,
  DataDescent,
  DataDistance,
  DataDuration,
  DataEPOC,
  DataEnergy,
  DataEffortPaceAvg,
  DataEffortPaceMax,
  DataEffortPaceMin,
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedPaceMax,
  DataGradeAdjustedPaceMin,
  DataHeartRateAvg,
  DataJumpDistanceAvg,
  DataJumpDistanceMax,
  DataJumpDistanceMin,
  DataJumpHangTimeAvg,
  DataJumpHangTimeMax,
  DataJumpHangTimeMin,
  DataJumpHeightAvg,
  DataJumpHeightMax,
  DataJumpHeightMin,
  DataJumpRotationsAvg,
  DataJumpRotationsMax,
  DataJumpRotationsMin,
  DataJumpScoreAvg,
  DataJumpScoreMax,
  DataJumpScoreMin,
  DataJumpSpeedAvg,
  DataJumpSpeedMax,
  DataJumpSpeedMin,
  DataPaceAvg,
  DataPaceMax,
  DataPaceMin,
  DataPowerAvg,
  DataPowerIntensityFactor,
  DataPowerNormalized,
  DataPowerTrainingStressScore,
  DataPowerWork,
  DataRecoveryTime,
  DataSpeedAvg,
  DataSwimPaceAvg,
  DataSwimPaceMax,
  DataSwimPaceMin,
  DataVO2Max,
  DynamicDataLoader,
} from '@sports-alliance/sports-lib';
import {
  getAiInsightsDefaultMetricPrompt,
  type AiInsightsPromptMetricKey,
} from '../../../../shared/ai-insights-prompts';

export type InsightMetricKey = AiInsightsPromptMetricKey;

export interface InsightMetricDefinition {
  key: InsightMetricKey;
  dataType: string;
  label: string;
  aliases: string[];
  defaultValueType: ChartDataValueTypes;
  allowedValueTypes: ChartDataValueTypes[];
  suggestedPrompt: string;
  familyType?: string;
  variantDataTypes?: Partial<Record<ChartDataValueTypes, string>>;
}

export interface InsightMetricAliasMatch {
  metric: InsightMetricDefinition;
  alias: string;
  start: number;
  end: number;
}

function normalizeMetricText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function tokenizeMetricText(value: string): string[] {
  const normalized = normalizeMetricText(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const SUPPORTED_INSIGHT_METRICS: readonly InsightMetricDefinition[] = [
  {
    key: 'distance',
    dataType: DataDistance.type,
    label: 'distance',
    aliases: ['distance', 'total distance', 'mileage', 'miles', 'mi', 'kilometers', 'kilometres', 'km'],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('distance'),
  },
  {
    key: 'duration',
    dataType: DataDuration.type,
    label: 'duration',
    aliases: ['duration', 'time spent', 'training time', 'workout duration'],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('duration'),
  },
  {
    key: 'ascent',
    dataType: DataAscent.type,
    label: 'ascent',
    aliases: ['ascent', 'elevation gain', 'climbing', 'climb'],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('ascent'),
  },
  {
    key: 'descent',
    dataType: DataDescent.type,
    label: 'descent',
    aliases: ['descent', 'elevation loss', 'descending'],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('descent'),
  },
  {
    key: 'jump_height',
    dataType: DataJumpHeightAvg.type,
    label: 'jump height',
    aliases: [
      'jump height',
      'average jump height',
      'avg jump height',
      'minimum jump height',
      'min jump height',
      'maximum jump height',
      'max jump height',
      'highest jump',
      'biggest jump',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('jump_height'),
    variantDataTypes: {
      [ChartDataValueTypes.Average]: DataJumpHeightAvg.type,
      [ChartDataValueTypes.Minimum]: DataJumpHeightMin.type,
      [ChartDataValueTypes.Maximum]: DataJumpHeightMax.type,
    },
  },
  {
    key: 'jump_hang_time',
    dataType: DataJumpHangTimeAvg.type,
    label: 'jump hang time',
    aliases: [
      'jump hang time',
      'hang time',
      'air time',
      'average jump hang time',
      'avg jump hang time',
      'minimum jump hang time',
      'min jump hang time',
      'maximum jump hang time',
      'max jump hang time',
      'biggest hang time',
      'longest hang time',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('jump_hang_time'),
    variantDataTypes: {
      [ChartDataValueTypes.Average]: DataJumpHangTimeAvg.type,
      [ChartDataValueTypes.Minimum]: DataJumpHangTimeMin.type,
      [ChartDataValueTypes.Maximum]: DataJumpHangTimeMax.type,
    },
  },
  {
    key: 'jump_distance',
    dataType: DataJumpDistanceAvg.type,
    label: 'jump distance',
    aliases: [
      'jump distance',
      'average jump distance',
      'avg jump distance',
      'minimum jump distance',
      'min jump distance',
      'maximum jump distance',
      'max jump distance',
      'longest jump',
      'farthest jump',
      'furthest jump',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('jump_distance'),
    variantDataTypes: {
      [ChartDataValueTypes.Average]: DataJumpDistanceAvg.type,
      [ChartDataValueTypes.Minimum]: DataJumpDistanceMin.type,
      [ChartDataValueTypes.Maximum]: DataJumpDistanceMax.type,
    },
  },
  {
    key: 'jump_speed',
    dataType: DataJumpSpeedAvg.type,
    label: 'jump speed',
    aliases: [
      'jump speed',
      'average jump speed',
      'avg jump speed',
      'minimum jump speed',
      'min jump speed',
      'maximum jump speed',
      'max jump speed',
      'fastest jump',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('jump_speed'),
    variantDataTypes: {
      [ChartDataValueTypes.Average]: DataJumpSpeedAvg.type,
      [ChartDataValueTypes.Minimum]: DataJumpSpeedMin.type,
      [ChartDataValueTypes.Maximum]: DataJumpSpeedMax.type,
    },
  },
  {
    key: 'jump_rotations',
    dataType: DataJumpRotationsAvg.type,
    label: 'jump rotations',
    aliases: [
      'jump rotations',
      'rotations',
      'average jump rotations',
      'avg jump rotations',
      'minimum jump rotations',
      'min jump rotations',
      'maximum jump rotations',
      'max jump rotations',
      'most rotations',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('jump_rotations'),
    variantDataTypes: {
      [ChartDataValueTypes.Average]: DataJumpRotationsAvg.type,
      [ChartDataValueTypes.Minimum]: DataJumpRotationsMin.type,
      [ChartDataValueTypes.Maximum]: DataJumpRotationsMax.type,
    },
  },
  {
    key: 'jump_score',
    dataType: DataJumpScoreAvg.type,
    label: 'jump score',
    aliases: [
      'jump score',
      'average jump score',
      'avg jump score',
      'minimum jump score',
      'min jump score',
      'maximum jump score',
      'max jump score',
      'best jump score',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('jump_score'),
    variantDataTypes: {
      [ChartDataValueTypes.Average]: DataJumpScoreAvg.type,
      [ChartDataValueTypes.Minimum]: DataJumpScoreMin.type,
      [ChartDataValueTypes.Maximum]: DataJumpScoreMax.type,
    },
  },
  {
    key: 'cadence',
    dataType: DataCadenceAvg.type,
    label: 'cadence',
    aliases: [
      'cadence',
      'average cadence',
      'avg cadence',
      'minimum cadence',
      'min cadence',
      'maximum cadence',
      'max cadence',
      'highest cadence',
      'lowest cadence',
      'rpm',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('cadence'),
    familyType: 'Cadence',
  },
  {
    key: 'power',
    dataType: DataPowerAvg.type,
    label: 'power',
    aliases: [
      'power',
      'average power',
      'avg power',
      'minimum power',
      'min power',
      'maximum power',
      'max power',
      'highest power',
      'lowest power',
      'watts',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('power'),
    familyType: 'Power',
  },
  {
    key: 'heart_rate',
    dataType: DataHeartRateAvg.type,
    label: 'heart rate',
    aliases: [
      'heart rate',
      'average heart rate',
      'avg heart rate',
      'minimum heart rate',
      'min heart rate',
      'maximum heart rate',
      'max heart rate',
      'highest heart rate',
      'lowest heart rate',
      'hr',
      'pulse',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('heart_rate'),
    familyType: 'Heart Rate',
  },
  {
    key: 'speed',
    dataType: DataSpeedAvg.type,
    label: 'speed',
    aliases: [
      'speed',
      'average speed',
      'avg speed',
      'minimum speed',
      'min speed',
      'maximum speed',
      'max speed',
      'highest speed',
      'lowest speed',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('speed'),
    familyType: 'Speed',
  },
  {
    key: 'pace',
    dataType: DataPaceAvg.type,
    label: 'pace',
    aliases: [
      'pace',
      'average pace',
      'avg pace',
      'running pace',
      'minimum pace',
      'min pace',
      'maximum pace',
      'max pace',
      'fastest pace',
      'slowest pace',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('pace'),
    familyType: 'Pace',
    variantDataTypes: {
      [ChartDataValueTypes.Average]: DataPaceAvg.type,
      [ChartDataValueTypes.Minimum]: DataPaceMin.type,
      [ChartDataValueTypes.Maximum]: DataPaceMax.type,
    },
  },
  {
    key: 'grade_adjusted_pace',
    dataType: DataGradeAdjustedPaceAvg.type,
    label: 'grade adjusted pace',
    aliases: [
      'grade adjusted pace',
      'average grade adjusted pace',
      'avg grade adjusted pace',
      'minimum grade adjusted pace',
      'min grade adjusted pace',
      'maximum grade adjusted pace',
      'max grade adjusted pace',
      'fastest grade adjusted pace',
      'slowest grade adjusted pace',
      'gap',
      'average gap',
      'avg gap',
      'grade adjusted running pace',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('grade_adjusted_pace'),
    familyType: 'Grade Adjusted Pace',
    variantDataTypes: {
      [ChartDataValueTypes.Average]: DataGradeAdjustedPaceAvg.type,
      [ChartDataValueTypes.Minimum]: DataGradeAdjustedPaceMin.type,
      [ChartDataValueTypes.Maximum]: DataGradeAdjustedPaceMax.type,
    },
  },
  {
    key: 'effort_pace',
    dataType: DataEffortPaceAvg.type,
    label: 'effort pace',
    aliases: [
      'effort pace',
      'average effort pace',
      'avg effort pace',
      'minimum effort pace',
      'min effort pace',
      'maximum effort pace',
      'max effort pace',
      'fastest effort pace',
      'slowest effort pace',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('effort_pace'),
    familyType: 'Effort Pace',
    variantDataTypes: {
      [ChartDataValueTypes.Average]: DataEffortPaceAvg.type,
      [ChartDataValueTypes.Minimum]: DataEffortPaceMin.type,
      [ChartDataValueTypes.Maximum]: DataEffortPaceMax.type,
    },
  },
  {
    key: 'swim_pace',
    dataType: DataSwimPaceAvg.type,
    label: 'swim pace',
    aliases: [
      'swim pace',
      'average swim pace',
      'avg swim pace',
      'minimum swim pace',
      'min swim pace',
      'maximum swim pace',
      'max swim pace',
      'fastest swim pace',
      'slowest swim pace',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('swim_pace'),
    variantDataTypes: {
      [ChartDataValueTypes.Average]: DataSwimPaceAvg.type,
      [ChartDataValueTypes.Minimum]: DataSwimPaceMin.type,
      [ChartDataValueTypes.Maximum]: DataSwimPaceMax.type,
    },
  },
  {
    key: 'training_stress_score',
    dataType: DataPowerTrainingStressScore.type,
    label: 'training stress score',
    aliases: [
      'training stress score',
      'tss',
      'average training stress score',
      'avg training stress score',
      'average tss',
      'avg tss',
      'minimum training stress score',
      'min training stress score',
      'minimum tss',
      'min tss',
      'maximum training stress score',
      'max training stress score',
      'maximum tss',
      'max tss',
      'highest training stress score',
      'lowest training stress score',
      'highest tss',
      'lowest tss',
    ],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('training_stress_score'),
  },
  {
    key: 'normalized_power',
    dataType: DataPowerNormalized.type,
    label: 'normalized power',
    aliases: [
      'normalized power',
      'np',
      'average normalized power',
      'avg normalized power',
      'average np',
      'avg np',
      'minimum normalized power',
      'min normalized power',
      'minimum np',
      'min np',
      'maximum normalized power',
      'max normalized power',
      'maximum np',
      'max np',
      'highest normalized power',
      'lowest normalized power',
      'highest np',
      'lowest np',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('normalized_power'),
  },
  {
    key: 'intensity_factor',
    dataType: DataPowerIntensityFactor.type,
    label: 'intensity factor',
    aliases: [
      'intensity factor',
      'average intensity factor',
      'avg intensity factor',
      'minimum intensity factor',
      'min intensity factor',
      'maximum intensity factor',
      'max intensity factor',
      'highest intensity factor',
      'lowest intensity factor',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('intensity_factor'),
  },
  {
    key: 'power_work',
    dataType: DataPowerWork.type,
    label: 'power work',
    aliases: [
      'power work',
      'average power work',
      'avg power work',
      'minimum power work',
      'min power work',
      'maximum power work',
      'max power work',
      'highest power work',
      'lowest power work',
      'total power work',
    ],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('power_work'),
  },
  {
    key: 'vo2_max',
    dataType: DataVO2Max.type,
    label: 'vo2 max',
    aliases: [
      'vo2 max',
      'vo2max',
      'average vo2 max',
      'avg vo2 max',
      'minimum vo2 max',
      'min vo2 max',
      'maximum vo2 max',
      'max vo2 max',
      'highest vo2 max',
      'lowest vo2 max',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('vo2_max'),
  },
  {
    key: 'epoc',
    dataType: DataEPOC.type,
    label: 'epoc',
    aliases: [
      'epoc',
      'average epoc',
      'avg epoc',
      'minimum epoc',
      'min epoc',
      'maximum epoc',
      'max epoc',
      'highest epoc',
      'lowest epoc',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('epoc'),
  },
  {
    key: 'avg_vam',
    dataType: DataAvgVAM.type,
    label: 'average VAM',
    aliases: [
      'average vam',
      'avg vam',
      'vam',
      'minimum vam',
      'min vam',
      'maximum vam',
      'max vam',
      'highest vam',
      'lowest vam',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('avg_vam'),
  },
  {
    key: 'aerobic_training_effect',
    dataType: DataAerobicTrainingEffect.type,
    label: 'aerobic training effect',
    aliases: [
      'aerobic training effect',
      'aerobic effect',
      'average aerobic training effect',
      'avg aerobic training effect',
      'minimum aerobic training effect',
      'min aerobic training effect',
      'maximum aerobic training effect',
      'max aerobic training effect',
      'highest aerobic training effect',
      'lowest aerobic training effect',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('aerobic_training_effect'),
  },
  {
    key: 'anaerobic_training_effect',
    dataType: DataAnaerobicTrainingEffect.type,
    label: 'anaerobic training effect',
    aliases: [
      'anaerobic training effect',
      'anaerobic effect',
      'average anaerobic training effect',
      'avg anaerobic training effect',
      'minimum anaerobic training effect',
      'min anaerobic training effect',
      'maximum anaerobic training effect',
      'max anaerobic training effect',
      'highest anaerobic training effect',
      'lowest anaerobic training effect',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('anaerobic_training_effect'),
  },
  {
    key: 'recovery_time',
    dataType: DataRecoveryTime.type,
    label: 'recovery time',
    aliases: [
      'recovery time',
      'average recovery time',
      'avg recovery time',
      'minimum recovery time',
      'min recovery time',
      'maximum recovery time',
      'max recovery time',
      'highest recovery time',
      'lowest recovery time',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('recovery_time'),
  },
  {
    key: 'calories',
    dataType: DataEnergy.type,
    label: 'calories',
    aliases: ['calories', 'calories burned', 'energy', 'energy burned'],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: getAiInsightsDefaultMetricPrompt('calories'),
  },
] as const;

const METRIC_INDEX = new Map<string, InsightMetricDefinition>(
  SUPPORTED_INSIGHT_METRICS.flatMap((metric) => {
    const searchTerms = new Set<string>([
      metric.key,
      metric.dataType,
      metric.label,
      ...metric.aliases,
    ].map(normalizeMetricText));

    return [...searchTerms].map((term) => [term, metric] as const);
  }),
);

function resolveExplicitVariantValueType(metricText: string): ChartDataValueTypes | null {
  const normalized = normalizeMetricText(metricText);
  if (!normalized) {
    return null;
  }

  if (/\b(max|maximum|highest|peak|top)\b/.test(normalized)) {
    return ChartDataValueTypes.Maximum;
  }
  if (/\b(min|minimum|lowest|bottom)\b/.test(normalized)) {
    return ChartDataValueTypes.Minimum;
  }
  if (/\b(avg|average|mean)\b/.test(normalized)) {
    return ChartDataValueTypes.Average;
  }

  return null;
}

function resolveFamilyVariantDataType(
  metric: InsightMetricDefinition,
  valueType: ChartDataValueTypes,
  explicitVariantValueType: ChartDataValueTypes | null,
): string {
  const resolvedValueType = explicitVariantValueType || valueType;
  const explicitVariantDataType = metric.variantDataTypes?.[resolvedValueType];
  if (explicitVariantDataType) {
    return explicitVariantDataType;
  }

  if (!metric.familyType) {
    return metric.dataType;
  }

  switch (resolvedValueType) {
    case ChartDataValueTypes.Minimum:
      return DynamicDataLoader.dataTypeMinDataType?.[metric.familyType] || metric.dataType;
    case ChartDataValueTypes.Maximum:
      return DynamicDataLoader.dataTypeMaxDataType?.[metric.familyType] || metric.dataType;
    case ChartDataValueTypes.Average:
    default:
      return DynamicDataLoader.dataTypeAvgDataType?.[metric.familyType] || metric.dataType;
  }
}

export function getInsightMetricDefinition(metricKey: InsightMetricKey): InsightMetricDefinition | undefined {
  return SUPPORTED_INSIGHT_METRICS.find(metric => metric.key === metricKey);
}

export function resolveInsightMetric(
  metricOrAlias: string,
  valueType?: ChartDataValueTypes,
): InsightMetricDefinition | null {
  const normalized = normalizeMetricText(metricOrAlias);
  if (!normalized) {
    return null;
  }

  const metric = METRIC_INDEX.get(normalized) || null;
  if (!metric || valueType === undefined) {
    return metric;
  }

  return {
    ...metric,
    dataType: resolveFamilyVariantDataType(metric, valueType, resolveExplicitVariantValueType(metricOrAlias)),
  };
}

export function findInsightMetricAliasMatch(
  sourceText: string,
): { metric: InsightMetricDefinition; alias: string } | null {
  const matches = findInsightMetricAliasMatches(sourceText);
  if (!matches.length) {
    return null;
  }

  const [{ metric, alias }] = matches;
  return { metric, alias };
}

export function findInsightMetricAliasMatches(
  sourceText: string,
): InsightMetricAliasMatch[] {
  const normalizedSource = normalizeMetricText(sourceText);
  if (!normalizedSource) {
    return [];
  }

  const metricMatches = SUPPORTED_INSIGHT_METRICS
    .map((metric) => {
      const aliases = [...new Set([
        metric.key,
        metric.dataType,
        metric.label,
        ...metric.aliases,
      ])]
        .map(alias => normalizeMetricText(alias))
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);

      let bestMatch: InsightMetricAliasMatch | null = null;
      for (const alias of aliases) {
        const pattern = new RegExp(`(^|\\s)(${escapeRegExp(alias)})(?=$|\\s)`, 'g');
        let match: RegExpExecArray | null = pattern.exec(normalizedSource);
        while (match) {
          const start = match.index + match[1].length;
          const end = start + match[2].length;
          if (
            !bestMatch
            || start < bestMatch.start
            || (start === bestMatch.start && alias.length > bestMatch.alias.length)
          ) {
            bestMatch = {
              metric,
              alias,
              start,
              end,
            };
          }
          match = pattern.exec(normalizedSource);
        }
      }

      return bestMatch;
    })
    .filter((match): match is InsightMetricAliasMatch => match !== null)
    .sort((left, right) => (
      left.start - right.start
      || right.alias.length - left.alias.length
      || left.metric.key.localeCompare(right.metric.key)
    ));

  const nonOverlappingMatches: InsightMetricAliasMatch[] = [];
  for (const match of metricMatches) {
    const overlaps = nonOverlappingMatches.some(existing => (
      match.start < existing.end && match.end > existing.start
    ));
    if (!overlaps) {
      nonOverlappingMatches.push(match);
    }
  }

  return nonOverlappingMatches;
}

export function resolveMetricVariantAlias(
  metric: InsightMetricDefinition,
  sourceText: string,
): string | null {
  const normalizedSource = normalizeMetricText(sourceText);
  if (!normalizedSource) {
    return null;
  }

  const candidateAliases = [...new Set([metric.label, ...metric.aliases])]
    .map(alias => normalizeMetricText(alias))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  return candidateAliases.find(alias => normalizedSource.includes(alias)) || null;
}

export function isAggregationAllowedForMetric(
  metricKey: InsightMetricKey,
  valueType: ChartDataValueTypes,
): boolean {
  const metric = getInsightMetricDefinition(metricKey);
  return metric?.allowedValueTypes.includes(valueType) === true;
}

export function buildMetricCatalogPromptText(): string {
  return SUPPORTED_INSIGHT_METRICS.map((metric) => {
    const aliases = metric.aliases.join(', ');
    const aggregations = metric.allowedValueTypes.join(', ');
    return `- ${metric.key}: dataType=${metric.dataType}; label=${metric.label}; aliases=${aliases}; allowed aggregations=${aggregations}`;
  }).join('\n');
}

function buildSuggestedPromptScore(
  metric: InsightMetricDefinition,
  sourceText: string,
  sourceTokens: Set<string>,
  explicitMetricMatch: InsightMetricDefinition | null,
): number {
  if (!sourceText) {
    return 0;
  }

  let score = 0;
  if (explicitMetricMatch?.key === metric.key) {
    score += 1000;
  }

  const searchTerms = [...new Set([
    metric.key,
    metric.dataType,
    metric.label,
    ...metric.aliases,
  ])].map(normalizeMetricText);

  for (const searchTerm of searchTerms) {
    if (!searchTerm) {
      continue;
    }

    if (sourceText.includes(searchTerm)) {
      score = Math.max(score, 500 + searchTerm.length);
    }

    const overlapCount = tokenizeMetricText(searchTerm)
      .filter(token => sourceTokens.has(token))
      .length;
    score = Math.max(score, overlapCount * 10);
  }

  return score;
}

export function getSuggestedInsightPrompts(limit = 3, sourceText?: string): string[] {
  const normalizedSource = normalizeMetricText(sourceText || '');
  const sourceTokens = new Set(tokenizeMetricText(sourceText || ''));
  const explicitMetricMatch = normalizedSource
    ? (findInsightMetricAliasMatch(sourceText || '')?.metric ?? null)
    : null;

  return SUPPORTED_INSIGHT_METRICS
    .map((metric, index) => ({
      metric,
      index,
      score: buildSuggestedPromptScore(metric, normalizedSource, sourceTokens, explicitMetricMatch),
    }))
    .sort((left, right) => (
      right.score - left.score
      || left.index - right.index
    ))
    .slice(0, Math.max(0, limit))
    .map(({ metric }) => metric.suggestedPrompt);
}
