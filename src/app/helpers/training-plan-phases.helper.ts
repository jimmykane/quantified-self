import { addDaysToTrainingLocalDate, type TrainingPlanV1, type TrainingPlanPhaseV1 } from '@shared/training-plans';
import { trainingPlanAppearance } from './training-plan-appearance.helper';

export function trainingPlanPhaseOnDate(plan: Pick<TrainingPlanV1, 'startLocalDate' | 'endLocalDate' | 'phases'> | null | undefined,
  localDate: string): TrainingPlanPhaseV1 | null {
  if (!plan || localDate < plan.startLocalDate || localDate > plan.endLocalDate) return null;
  return plan.phases?.items.find(phase => localDate >= phase.startLocalDate && localDate <= phase.endLocalDate) ?? null;
}

export interface CalendarPlanPhase {
  phase: TrainingPlanPhaseV1; planName: string; color: string; boundary: string | null; ariaLabel: string;
}
export type CalendarPlanPhases = Readonly<Record<string, CalendarPlanPhase>>;

/** Calendar's owner-only active plan scope. Paused/archived phases remain available in Plans. */
export function buildCalendarPlanPhases(plans: readonly TrainingPlanV1[], activePlanId: string | null): CalendarPlanPhases {
  const plan = plans.find(item => item.id === activePlanId && item.lifecycle === 'active');
  const result: Record<string, CalendarPlanPhase> = {};
  if (!plan) return result;
  for (const phase of plan.phases?.items ?? []) {
    const color = trainingPlanAppearance({ color: phase.color ?? plan.color }).color;
    for (let date = phase.startLocalDate; date <= phase.endLocalDate; date = addDaysToTrainingLocalDate(date, 1)) {
      const boundary = date === phase.startLocalDate && date === phase.endLocalDate ? 'Starts and ends'
        : date === phase.startLocalDate ? 'Starts' : date === phase.endLocalDate ? 'Ends' : null;
      result[date] = { phase, planName: plan.name, color, boundary,
        ariaLabel: `Plan phase: ${phase.name}. ${phase.startLocalDate} through ${phase.endLocalDate}.${boundary ? ` ${boundary} today.` : ''}` };
      if (date === phase.endLocalDate) break;
    }
  }
  return result;
}
