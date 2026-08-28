import {
  HEALTH_SOURCE_RECORDS_COLLECTION_ID,
  HEALTH_SAMPLE_CHUNKS_COLLECTION_ID,
  HealthQueryCursor,
  HealthRangeQuery,
  NormalizedHealthRangeQuery,
} from './health';
import { normalizeHealthRangeQuery } from './health-query';

export type HealthFirestoreFilterOperator = '==' | 'in' | 'array-contains' | 'array-contains-any';

export interface HealthFirestoreFilterPlan {
  field: string;
  operator: HealthFirestoreFilterOperator;
  value: string | string[];
}

export interface HealthFirestoreQueryPlan {
  collectionId: typeof HEALTH_SOURCE_RECORDS_COLLECTION_ID | typeof HEALTH_SAMPLE_CHUNKS_COLLECTION_ID;
  startDate: string;
  endDate: string;
  filter: HealthFirestoreFilterPlan | null;
  cursor: HealthQueryCursor | null;
  fetchLimit: number;
}

export interface HealthFirestoreQueryPlans {
  query: NormalizedHealthRangeQuery;
  sourceRecords: HealthFirestoreQueryPlan;
  chunks: HealthFirestoreQueryPlan | null;
}

function providerFilter(field: string, providers: readonly string[]): HealthFirestoreFilterPlan | null {
  if (providers.length === 1) {
    return { field, operator: '==', value: providers[0] };
  }
  if (providers.length > 1) {
    return { field, operator: 'in', value: [...providers] };
  }
  return null;
}

function sourceRecordMetricFilter(metricIds: readonly string[]): HealthFirestoreFilterPlan | null {
  if (metricIds.length === 1) {
    return { field: 'metricIds', operator: 'array-contains', value: metricIds[0] };
  }
  if (metricIds.length > 1) {
    return { field: 'metricIds', operator: 'array-contains-any', value: [...metricIds] };
  }
  return null;
}

function chunkMetricFilter(metricIds: readonly string[]): HealthFirestoreFilterPlan | null {
  if (metricIds.length === 1) {
    return { field: 'metricId', operator: '==', value: metricIds[0] };
  }
  if (metricIds.length > 1) {
    return { field: 'metricId', operator: 'in', value: [...metricIds] };
  }
  return null;
}

export function planHealthFirestoreQueries(
  queryValue: HealthRangeQuery | NormalizedHealthRangeQuery | unknown,
): HealthFirestoreQueryPlans {
  const query = normalizeHealthRangeQuery(queryValue);
  // A provider predicate takes precedence so provider + metric queries do not
  // require a combinatorial provider/metric/date index. The shared projector
  // applies every requested filter to the bounded result set afterward.
  const sourceRecordFilter = providerFilter('source.provider', query.providers)
    || sourceRecordMetricFilter(query.metricIds);
  const chunkFilter = providerFilter('provider', query.providers)
    || chunkMetricFilter(query.metricIds);
  return {
    query,
    sourceRecords: {
      collectionId: HEALTH_SOURCE_RECORDS_COLLECTION_ID,
      startDate: query.startDate,
      endDate: query.endDate,
      filter: sourceRecordFilter,
      cursor: query.sourceRecordCursor,
      fetchLimit: query.sourceRecordLimit + 1,
    },
    chunks: query.includeSamples ? {
      collectionId: HEALTH_SAMPLE_CHUNKS_COLLECTION_ID,
      startDate: query.startDate,
      endDate: query.endDate,
      filter: chunkFilter,
      cursor: query.chunkCursor,
      fetchLimit: query.chunkLimit + 1,
    } : null,
  };
}
