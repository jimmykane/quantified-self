import {
  EVENT_SUMMARY_METRIC_GROUPS,
  EventSummaryMetricGroupConfig,
  EventSummaryMetricGroupId,
} from '../constants/event-summary-metric-groups';

export interface SummaryMetricTab {
  id: EventSummaryMetricGroupId;
  label: string;
  metricTypes: string[];
  singleValueTypes?: string[];
}

const OTHER_GROUP_ID: EventSummaryMetricGroupId = 'other';
const OVERALL_GROUP_ID: EventSummaryMetricGroupId = 'overall';

export const buildSummaryMetricTabs = (resolvedMetricTypes: string[]): SummaryMetricTab[] => {
  if (!resolvedMetricTypes.length) {
    return [];
  }

  const uniqueMetricTypes = [...new Set(resolvedMetricTypes).values()];
  const uniqueMetricTypeSet = new Set(uniqueMetricTypes);

  const configuredGroups = EVENT_SUMMARY_METRIC_GROUPS.filter((group) => group.id !== OTHER_GROUP_ID);
  const knownConfiguredMetricTypes = new Set<string>();
  configuredGroups.forEach((group) => {
    group.metricTypes.forEach((metricType) => knownConfiguredMetricTypes.add(metricType));
  });

  const overallGroup = EVENT_SUMMARY_METRIC_GROUPS.find((group) => group.id === OVERALL_GROUP_ID);
  const tabsMap = new Map<EventSummaryMetricGroupId, SummaryMetricTab>();
  EVENT_SUMMARY_METRIC_GROUPS.forEach((group) => {
    tabsMap.set(group.id, {
      id: group.id,
      label: group.label,
      metricTypes: [],
      singleValueTypes: group.singleValueTypes || [],
    });
  });

  if (overallGroup) {
    const overallTab = tabsMap.get(overallGroup.id);
    if (overallTab) {
      overallGroup.metricTypes.forEach((metricType) => {
        if (uniqueMetricTypeSet.has(metricType)) {
          overallTab.metricTypes.push(metricType);
        }
      });
    }
  }

  EVENT_SUMMARY_METRIC_GROUPS.forEach((group: EventSummaryMetricGroupConfig) => {
    if (group.id === OVERALL_GROUP_ID || group.id === OTHER_GROUP_ID) {
      return;
    }
    const tab = tabsMap.get(group.id);
    if (!tab) {
      return;
    }
    group.metricTypes.forEach((metricType) => {
      if (uniqueMetricTypeSet.has(metricType)) {
        tab.metricTypes.push(metricType);
      }
    });
  });

  const otherTab = tabsMap.get(OTHER_GROUP_ID);
  if (otherTab) {
    uniqueMetricTypes.forEach((metricType) => {
      if (!knownConfiguredMetricTypes.has(metricType)) {
        otherTab.metricTypes.push(metricType);
      }
    });
  }

  return EVENT_SUMMARY_METRIC_GROUPS
    .map((group) => tabsMap.get(group.id))
    .filter((tab): tab is SummaryMetricTab => !!tab && tab.metricTypes.length > 0);
};
