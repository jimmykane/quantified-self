import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { diffAssistantWorkoutNodes, equalWorkoutReviewValue, type AssistantWorkoutReview, type AssistantWorkoutSnapshot } from '@shared/assistant-workout-review';
import { formatWorkoutEndingV1, formatWorkoutStepV1, type WorkoutNodeV1 } from '@shared/planned-workout';
import { analyzeWorkoutStructureV1 } from '@shared/planned-workout-analysis';
import { formatWorkoutPrescriptionSummaryV1 } from '@shared/planned-workout-analysis-display';
import { formatAssistantCalendarDate } from './assistant-message-format.helper';

export function assistantWorkoutReviewModel(review: AssistantWorkoutReview, units?: UserUnitSettingsInterface | null, locale?: string) {
  const before = review.before, after = review.after;
  const summarize = (value: AssistantWorkoutSnapshot | null, absent: string) => value
    ? formatWorkoutPrescriptionSummaryV1(value.structure, units, value.structure.sport, locale) : absent;
  const describe = (node: WorkoutNodeV1 | null, source: AssistantWorkoutSnapshot | null) => !node ? 'Absent'
    : node.kind === 'repeat' ? `Repeat ${node.count} times` : `${formatWorkoutStepV1(node, units, locale, source?.structure.sport)}${node.note !== undefined ? ` · Note: ${node.note || '(empty)'}` : ''}`;
  const changes = diffAssistantWorkoutNodes(before?.structure ?? null, after?.structure ?? null).map(change => {
    const prior = describe(change.before, before), next = describe(change.after, after);
    return { ...change, label: `${change.after?.kind === 'repeat' || change.before?.kind === 'repeat' ? 'Repeat' : 'Step'} ${change.afterPosition ?? change.beforePosition}`,
      fieldsText: change.fields.join(' · '), beforeText: prior, afterText: next,
      beforeLocation: change.beforePosition ? `Position ${change.beforePosition}` : 'New definition',
      afterLocation: change.afterPosition ? `Position ${change.afterPosition}` : 'Removed definition',
      // A rounding collision must never disguise a real prescription edit as unchanged.
      precision: prior === next && !equalWorkoutReviewValue(change.before, change.after) && !change.fields.every(field => field === 'Order / repeat placement')
        ? `Exact prescription before: ${JSON.stringify(change.before)}. After: ${JSON.stringify(change.after)}.` : null,
    };
  });
  const metadata: Array<{ label: string; before: string; after: string }> = [];
  if (before && after) {
    for (const [key, label] of [['title', 'Title'], ['localDate', 'Date'], ['destination', 'Destination'], ['lifecycle', 'Status']] as const) {
      if (before[key] !== after[key]) metadata.push({ label, before: key === 'localDate' ? formatAssistantCalendarDate(before[key], locale) : before[key],
        after: key === 'localDate' ? formatAssistantCalendarDate(after[key], locale) : after[key] });
    }
    if (before.structure.sport !== after.structure.sport) metadata.push({ label: 'Sport', before: before.structure.sport, after: after.structure.sport });
    if (!equalWorkoutReviewValue(before.structure.poolLength, after.structure.poolLength)) {
      const pool = (value: AssistantWorkoutSnapshot) => value.structure.poolLength
        ? `${formatWorkoutEndingV1({ kind: 'distance', meters: value.structure.poolLength.meters }, units, locale, value.structure.sport)} (${value.structure.poolLength.presentation})` : 'Unspecified';
      metadata.push({ label: 'Pool length', before: pool(before), after: pool(after) });
    }
  }
  const counts = (value: AssistantWorkoutSnapshot | null) => {
    if (!value) return null;
    try { const result = analyzeWorkoutStructureV1(value.structure); return `${result.counts.definedSteps} step definitions · ${result.counts.executedSteps} executions`; }
    catch { return 'Counts unavailable'; }
  };
  const current = after ?? before!;
  return { title: current.title, date: formatAssistantCalendarDate(current.localDate, locale), destination: current.destination,
    beforeSummary: summarize(before, 'New workout'), afterSummary: summarize(after, 'Workout removed'),
    beforeCounts: counts(before), afterCounts: counts(after), metadata, changes,
    changedIds: changes.map(change => change.id), changeSummary: `${changes.length} changed definition${changes.length === 1 ? '' : 's'}`, structure: current.structure,
    mappingIssueCount: review.compatibility.reduce((count, item) => count + item.issues.length, 0),
    compatibility: review.compatibility.map(item => ({ ...item,
      label: `${item.provider.charAt(0).toUpperCase()}${item.provider.slice(1)}: ${item.before ?? 'new'} → ${item.after ?? 'removed'}`,
    })),
  };
}
