import {
  EVENT_SUMMARY_METRIC_GROUPS,
  EventSummaryMetricGroupConfig,
  EventSummaryMetricGroupId,
} from '../constants/event-summary-metric-groups';

export interface SummaryMetricTab {
  id: EventSummaryMetricGroupId;
  label: string;
  metricTypes: string[];
}

const OTHER_GROUP_ID: EventSummaryMetricGroupId = 'other';

export const buildSummaryMetricTabs = (resolvedMetricTypes: string[]): SummaryMetricTab[] => {
  if (!resolvedMetricTypes.length) {
    return [];
  }

  const tabMap = new Map<EventSummaryMetricGroupId, SummaryMetricTab>();
  EVENT_SUMMARY_METRIC_GROUPS.forEach((group) => {
    tabMap.set(group.id, { id: group.id, label: group.label, metricTypes: [] });
  });

  const seenMetricTypes = new Set<string>();
  resolvedMetricTypes.forEach((metricType) => {
    if (seenMetricTypes.has(metricType)) {
      return;
    }
    seenMetricTypes.add(metricType);

    const matchedGroup = EVENT_SUMMARY_METRIC_GROUPS.find((group: EventSummaryMetricGroupConfig) => {
      if (group.id === OTHER_GROUP_ID) {
        return false;
      }
      return group.metricTypes.includes(metricType);
    });

    const targetGroupId = matchedGroup?.id ?? OTHER_GROUP_ID;
    const tab = tabMap.get(targetGroupId);
    if (!tab) {
      return;
    }
    tab.metricTypes.push(metricType);
  });

  return EVENT_SUMMARY_METRIC_GROUPS
    .map((group) => tabMap.get(group.id))
    .filter((tab): tab is SummaryMetricTab => !!tab && tab.metricTypes.length > 0);
};
