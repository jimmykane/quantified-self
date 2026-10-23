import { DataActivityTypes, type ActivityInterface, type EventInterface } from '@sports-alliance/sports-lib';
import { readActivitySourceIdentity, type ActivitySourceIdentity } from '../../../shared/activity-source-identity';
import { getActivitySourceWindow, resolveActivityIdentityAssignments, type ActivityIdentityLike } from './activity-identity-matcher';
import { ActivityIdentityConflictError } from './activity-identity-conflict';

export interface SavedActivitySource {
  id: string;
  data(): Record<string, any>;
}

export function savedActivityIdentity(document: SavedActivitySource): ActivityIdentityLike {
  const data = document.data();
  return { getID: () => document.id, startDate: data.startDate, endDate: data.endDate, type: data.type,
    sourceActivityKey: data.sourceActivityKey, sourceIdentity: data.sourceIdentity,
    getStat: type => {
      const raw = data.stats?.[type];
      const value = raw && typeof raw === 'object' ? raw.value ?? raw.rawValue ?? raw._value : raw;
      const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
      return Number.isFinite(number) ? { getValue: () => number } : null;
    } };
}

export interface ActivityBindingPlan {
  verifiedActivityIds: ReadonlySet<string>;
  strictAssignments: ReadonlyMap<number, number>;
  activityTypes: readonly string[];
  apply(): void;
}

/** Validate first; apply saved IDs and source snapshots only after the reservation commits. */
export function prepareActivitySourceBindings(event: EventInterface, documents: SavedActivitySource[], options: {
  allowSourceWindowMatch?: boolean;
  allowNewActivities?: boolean;
  allowRemovedActivities?: boolean;
} = {}): ActivityBindingPlan {
  const activities = event.getActivities();
  const before = documents.map(savedActivityIdentity);
  const matches = resolveActivityIdentityAssignments(before, activities as ActivityIdentityLike[], {
    allowSourceWindowMatch: options.allowSourceWindowMatch,
  });
  if ((!options.allowRemovedActivities && matches.unmatchedExistingIndexes.length)
    || (!options.allowNewActivities && matches.unmatchedParsedIndexes.length)) throw new ActivityIdentityConflictError();
  const overlaps = (left: ActivityIdentityLike, right: ActivityIdentityLike) => {
    const a = getActivitySourceWindow(left), b = getActivitySourceWindow(right);
    return !a || !b || (a.startMs < b.endMs && b.startMs < a.endMs)
      || (a.startMs === b.startMs && a.endMs === b.endMs);
  };
  if (matches.unmatchedExistingIndexes.some(index => activities.some(activity => overlaps(before[index], activity as ActivityIdentityLike)))
    || matches.unmatchedParsedIndexes.some(index => before.some(activity => overlaps(activity, activities[index] as ActivityIdentityLike))))
    throw new ActivityIdentityConflictError();
  const ids = activities.map((activity, index) => {
    const existing = matches.assignments.get(index);
    return existing === undefined ? activity.getID() : documents[existing].id;
  });
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new ActivityIdentityConflictError();
  const bindings = activities.map((activity, index) => {
    const existingIndex = matches.assignments.get(index);
    const existing = existingIndex === undefined ? null : documents[existingIndex];
    const saved = existing?.data();
    const currentSource = readActivitySourceIdentity((activity as ActivityIdentityLike).sourceIdentity, activity.getID());
    const importedType = `${activity.type}`;
    const startMs = currentSource?.startMs ?? +activity.startDate, endMs = currentSource?.endMs ?? +activity.endDate;
    const sourceIdentity: ActivitySourceIdentity = { version: 1, activityId: ids[index]!, startMs, endMs, importedType };
    if (!readActivitySourceIdentity(sourceIdentity)) throw new ActivityIdentityConflictError();
    return { activity, id: ids[index]!, sourceIdentity, saved };
  });
  const verifiedActivityIds = new Set([...matches.assignments.values()].map(index => documents[index].id));
  const strictAssignments = resolveActivityIdentityAssignments(before, activities as ActivityIdentityLike[], {
    requireStrictMatch: true, allowSourceWindowMatch: options.allowSourceWindowMatch,
  }).assignments;
  // Corrections may validate the chosen ID pairing, never independently choose a different saved leg.
  strictAssignments.forEach((existingIndex, parsedIndex) => {
    if (matches.assignments.get(parsedIndex) !== existingIndex) strictAssignments.delete(parsedIndex);
  });
  return { verifiedActivityIds, strictAssignments, activityTypes: activities.map(activity => activity.type), apply: () => {
    bindings.forEach(({ activity, id, sourceIdentity, saved }) => {
      activity.setID(id);
      (activity as ActivityInterface & { sourceIdentity: ActivitySourceIdentity }).sourceIdentity = sourceIdentity;
      if (saved?.sourceActivityKey && !(activity as ActivityIdentityLike).sourceActivityKey)
        (activity as ActivityIdentityLike).sourceActivityKey = saved.sourceActivityKey;
    });
    event.addStat(new DataActivityTypes(activities.map(activity => activity.type)));
  } };
}
