import {
  HEALTH_METRIC_IDS,
  HEALTH_NORMALIZATION_STATUSES,
  HEALTH_RECORDING_METHODS,
  HEALTH_UNITS,
  HEALTH_VALUE_ORIGINS,
  HealthMetricValue,
  HealthSampleChunk,
  HealthSourceRecord,
} from '@shared/health';

const INPUTS: Record<string, { aggregation: string; prefix: string; statistics: readonly string[] }> = {
  activity_interval_average: { aggregation: 'average', prefix: 'interval', statistics: ['mean', 'low', 'high'] },
  activity_interval_minimum: { aggregation: 'minimum', prefix: 'interval_minimum', statistics: ['low'] },
  activity_interval_maximum: { aggregation: 'maximum', prefix: 'interval_maximum', statistics: ['high'] },
  daily_15_second: { aggregation: 'representative_sample', prefix: 'sample', statistics: ['mean', 'low', 'high'] },
};

/** Presentation names describe the period and calculation, not just “Average”. */
export function heartRateSemanticLabel(semanticVariant: string, aggregation?: string): string | null {
  if (semanticVariant === 'health_snapshot') {
    const kind = { minimum: 'minimum', maximum: 'maximum', average: 'average', sample: 'readings' }[aggregation || ''];
    return kind ? `Health Snapshot ${kind} · Short measurement session` : null;
  }
  const labels: Record<string, string> = {
    daily_minimum: 'Daily minimum · Provider reported · Recorded monitoring period',
    daily_maximum: 'Daily maximum · Provider reported · Recorded monitoring period',
    rolling_7_day_average: '7-day average · Provider reported',
    daily_15_second: 'Heart rate throughout the day · 15-second samples',
    activity_interval_average: 'Heart rate throughout the day · Interval averages',
    activity_interval_minimum: 'Heart rate throughout the day · Interval minimums',
    activity_interval_maximum: 'Heart rate throughout the day · Interval maximums',
    qs_daily_interval_mean: 'Daily average of interval readings · Calculated by QS',
    qs_daily_interval_low: 'Daily lowest interval average · Calculated by QS',
    qs_daily_interval_high: 'Daily highest interval average · Calculated by QS',
    qs_daily_interval_minimum_low: 'Daily lowest recorded interval minimum · Calculated by QS',
    qs_daily_interval_maximum_high: 'Daily highest recorded interval maximum · Calculated by QS',
    qs_daily_sample_mean: 'Daily average of recorded samples · Calculated by QS',
    qs_daily_sample_low: 'Daily lowest recorded sample · Calculated by QS',
    qs_daily_sample_high: 'Daily highest recorded sample · Calculated by QS',
  };
  return labels[semanticVariant] || null;
}

/**
 * Read-only daily projection: never persist these entries or modify provider data.
 * Each record/series stays independent (including account, device and UTC offset).
 * A truncated chunk scan must exclude its boundary day, not average a page prefix.
 */
export function withDailyHeartRateSummaries(
  records: readonly HealthSourceRecord[],
  chunks: readonly HealthSampleChunk[],
  completeBeforeDate: string | null = null,
): HealthSourceRecord[] {
  const chunksByParent = new Map<string, HealthSampleChunk[]>();
  for (const chunk of chunks) {
    if (chunk.metricId !== HEALTH_METRIC_IDS.HeartRate) continue;
    const group = chunksByParent.get(chunk.parentSourceRecordId) || [];
    group.push(chunk);
    chunksByParent.set(chunk.parentSourceRecordId, group);
  }
  return records.map(record => {
    if (completeBeforeDate !== null && record.calendarDate >= completeBeforeDate) return record;
    const sourceChunks = chunksByParent.get(record.id) || [];
    // A concurrent source replacement can leave a mixture of revisions in a read.
    // Drop the parent's derived summaries until it can be read consistently.
    if (!sourceChunks.length || sourceChunks.some(chunk => !matchesParent(chunk, record))) return record;
    const groups = new Map<string, HealthSampleChunk[]>();
    for (const chunk of sourceChunks) {
      const input = INPUTS[chunk.semanticVariant];
      if (!input || chunk.aggregation !== input.aggregation
        || chunk.origin !== HEALTH_VALUE_ORIGINS.Recorded
        || chunk.recordingMethod !== HEALTH_RECORDING_METHODS.Device
        || chunk.normalizationStatus !== HEALTH_NORMALIZATION_STATUSES.Canonical
        || chunk.canonicalUnit !== HEALTH_UNITS.BeatsPerMinute) continue;
      const key = JSON.stringify([chunk.seriesKey, chunk.semanticVariant, chunk.aggregation,
        chunk.canonicalUnit, chunk.device ?? null]);
      const group = groups.get(key) || [];
      group.push(chunk);
      groups.set(key, group);
    }
    const summaries = [...groups.values()].flatMap(group => summarizeSeries(record, group));
    return summaries.length ? { ...record, metrics: [...record.metrics, ...summaries] } : record;
  });
}

function matchesParent(chunk: HealthSampleChunk, record: HealthSourceRecord): boolean {
  return chunk.userID === record.userID
    && chunk.provider === record.source.provider
    && chunk.accountKey === record.source.accountKey
    && chunk.calendarDate === record.calendarDate
    && (chunk.timezoneOffsetSeconds ?? null) === (record.timezoneOffsetSeconds ?? null)
    && record.sampleChunkIds.includes(chunk.id)
    && chunk.startTimeMs >= record.startTimeMs && chunk.endTimeMs <= record.endTimeMs
    && chunk.revision.order === record.source.revision.order
    && chunk.revision.token === record.source.revision.token
    && chunk.revision.digest === record.source.revision.digest;
}

export function countStaleHeartRateChunks(
  records: readonly HealthSourceRecord[], chunks: readonly HealthSampleChunk[],
): number {
  const byId = new Map(records.map(record => [record.id, record]));
  return chunks.filter(chunk => {
    const parent = byId.get(chunk.parentSourceRecordId);
    return parent && (chunk.revision.order !== parent.source.revision.order
      || chunk.revision.token !== parent.source.revision.token
      || chunk.revision.digest !== parent.source.revision.digest);
  }).length;
}

function summarizeSeries(record: HealthSourceRecord, chunks: HealthSampleChunk[]): HealthMetricValue[] {
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  if (ordered.some((chunk, index) => chunk.chunkIndex !== index
    || chunk.valueType !== 'number'
    || !Array.isArray(chunk.canonicalValues)
    || chunk.canonicalValues.length !== chunk.offsetMs.length)) return [];
  const first = ordered[0];
  const input = INPUTS[first.semanticVariant];
  const values = new Map<number, number>();
  let estimated = false;
  for (const chunk of ordered) {
    for (let index = 0; index < chunk.offsetMs.length; index++) {
      const value = chunk.canonicalValues?.[index];
      const time = chunk.startTimeMs + chunk.offsetMs[index];
      const quality = chunk.qualityCodes?.[index];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 300
        || !Number.isFinite(time) || time < chunk.startTimeMs || time > chunk.endTimeMs
        || (quality && !['valid', 'estimated', 'partial', 'unknown'].includes(quality))) continue;
      // Duplicate timestamps must not overweight a reading. Conflicts cannot be
      // resolved by whichever chunk happens to come last.
      if (values.has(time) && values.get(time) !== value) return [];
      values.set(time, value);
      estimated ||= quality === 'estimated';
    }
  }
  if (!values.size) return [];
  let sum = 0, low = Infinity, high = -Infinity;
  for (const value of values.values()) {
    sum += value;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const statistics = input.statistics.filter(statistic => {
    // Garmin already supplies extrema of recorded HR. Do not duplicate those
    // with extrema of its representative samples. Its 7-day mean is different.
    if (input.prefix !== 'sample' || statistic === 'mean') return true;
    const variant = statistic === 'low' ? 'daily_minimum' : 'daily_maximum';
    return !record.metrics.some(entry => entry.metricId === HEALTH_METRIC_IDS.HeartRate
      && entry.semanticVariant === variant && entry.origin === HEALTH_VALUE_ORIGINS.ProviderSummary);
  });
  return statistics.map(statistic => {
    const value = statistic === 'mean' ? sum / values.size : statistic === 'low' ? low : high;
    return {
      kind: 'value', metricId: HEALTH_METRIC_IDS.HeartRate, valueType: 'number',
      aggregation: statistic === 'mean' ? 'average' : statistic === 'low' ? 'minimum' : 'maximum',
      semanticVariant: `qs_daily_${input.prefix}_${statistic}`,
      origin: HEALTH_VALUE_ORIGINS.QuantifiedSelfDerived,
      recordingMethod: HEALTH_RECORDING_METHODS.QuantifiedSelfCalculated,
      normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
      quality: { status: estimated ? 'estimated' : 'valid' },
      native: { metric: `qs_daily_${input.prefix}_${statistic}`, value, unit: HEALTH_UNITS.BeatsPerMinute,
        qualifiers: { sampleCount: values.size, calculation: 'unweighted_recorded_samples' } },
      canonical: { value, unit: HEALTH_UNITS.BeatsPerMinute },
      device: first.device ?? record.device,
      coverage: {
        ...record.coverage,
        // An average of recorded intervals does not prove complete day coverage.
        status: ordered.some(chunk => chunk.coverage.status === 'partial')
          || record.coverage.status === 'partial' ? 'partial' : 'unknown',
        sampleCount: values.size,
      },
    };
  });
}
