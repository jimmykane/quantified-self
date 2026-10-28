import type { Data, ParamMap } from '@angular/router';
import { normalizeTrainingLocalDate } from '@shared/training-plans';

export type TrainingPlansRouteMode = 'browse' | 'create' | 'edit' | 'library-browse' | 'library-create' | 'library-edit';
export type TrainingPlansRouteScope = 'plans' | 'standalone';

export interface TrainingPlansRouteState {
  mode: TrainingPlansRouteMode;
  workoutId: string | null;
  planId: string | null;
  standalone: boolean;
  localDate: string | null;
  libraryItemId?: string | null;
}

export function parseTrainingPlansRoute(
  pathParams: ParamMap,
  queryParams: ParamMap,
  data: Data,
): TrainingPlansRouteState {
  let localDate: string | null = null;
  try {
    const date = queryParams.get('date');
    if (date) localDate = normalizeTrainingLocalDate(date);
  } catch { /* Invalid URL dates fall back to the current scope's normal date. */ }
  const mode = isMode(data['trainingPlansMode']) ? data['trainingPlansMode'] : 'browse';
  return {
    mode,
    workoutId: mode === 'edit' ? pathParams.get('workoutId')?.trim() || null : null,
    planId: pathParams.get('planId')?.trim() || null,
    standalone: data['trainingPlansScope'] === 'standalone',
    localDate,
    ...(mode === 'library-edit' ? { libraryItemId: pathParams.get('itemId')?.trim() || null } : {}),
  };
}

export function trainingPlansBrowseRoute(planId: string | null, standalone = planId === null): string[] {
  if (standalone) return ['/training/plans/standalone'];
  return planId ? ['/training/plans/plan', planId] : ['/training/plans'];
}

export function trainingPlansCreateRoute(planId: string | null, standalone = planId === null): string[] {
  if (standalone) return ['/training/plans/standalone/new'];
  return planId ? ['/training/plans/plan', planId, 'new'] : ['/training/plans/new'];
}

export function trainingPlansWorkoutRoute(workoutId: string): string[] {
  return ['/training/plans/workout', workoutId];
}

export function isTrainingPlansUrl(value: unknown): boolean {
  const url = `${value ?? ''}`;
  if (hasLegacyTrainingPlansQuery(url)) return false;
  return /^\/training\/plans(?:[?#]|$|\/(?:new|standalone(?:\/new)?|workout\/[^/?#]+|plan\/[^/?#]+(?:\/new)?|library(?:\/new|\/[^/?#]+)?)(?:[?#]|$))/.test(url);
}

export function isTrainingPlansBrowseUrl(value: unknown): boolean {
  const url = `${value ?? ''}`;
  if (hasLegacyTrainingPlansQuery(url)) return false;
  return /^\/training\/plans(?:[?#]|$|\/standalone(?:[?#]|$)|\/plan\/[^/?#]+(?:[?#]|$)|\/library(?:[?#]|$))/.test(url);
}

export function trainingPlansRouteKey(uid: string | undefined, state: TrainingPlansRouteState): string {
  return JSON.stringify([uid ?? null, state]);
}

function isMode(value: unknown): value is TrainingPlansRouteMode {
  return value === 'browse' || value === 'create' || value === 'edit'
    || value === 'library-browse' || value === 'library-create' || value === 'library-edit';
}

function hasLegacyTrainingPlansQuery(url: string): boolean {
  return /[?&](?:workout|plan|planId|scope|mode)=/.test(url);
}
