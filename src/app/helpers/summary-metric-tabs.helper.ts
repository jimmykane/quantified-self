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
    .filter((tab): tab is SummaryMetricTab => !!tab && tab.metricTypes.length > 0)
    .map((tab) => {
      const groupConfig = EVENT_SUMMARY_METRIC_GROUPS.find((group) => group.id === tab.id);
      if (!groupConfig || !groupConfig.metricTypes.length) {
        return tab;
      }

      const groupOrder = new Map<string, number>();
      groupConfig.metricTypes.forEach((metricType, index) => {
        groupOrder.set(metricType, index);
      });

      const orderedMetricTypes = [...tab.metricTypes].sort((left, right) => {
        const leftOrder = groupOrder.get(left);
        const rightOrder = groupOrder.get(right);
        if (leftOrder === undefined && rightOrder === undefined) {
          return 0;
        }
        if (leftOrder === undefined) {
          return 1;
        }
        if (rightOrder === undefined) {
          return -1;
        }
        return leftOrder - rightOrder;
      });

      return {
        ...tab,
        metricTypes: orderedMetricTypes,
      };
    });
};
