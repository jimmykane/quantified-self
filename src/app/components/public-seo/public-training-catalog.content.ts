import { FOUNDATIONAL_RUNNING_PLAN_SUMMARY, TRAINING_PROGRAMS } from '@shared/training-plan-programs';
import type { PlanAttribution } from '@shared/training-plan-templates';
import { PUBLIC_FEATURE_PATHS } from './public-seo-pages.paths';

interface PublicTrainingPlan {
  id: string;
  name: string;
  description: string;
  weeks: number;
  sport: 'Running' | 'Cycling';
  attribution?: PlanAttribution;
}

// Keep scheduling, workout prescriptions and account services outside the public discovery pages.
export const PUBLIC_TRAINING_PLANS: readonly PublicTrainingPlan[] = [
  ...TRAINING_PROGRAMS.map((program): PublicTrainingPlan => ({
    id: program.id,
    name: program.name,
    description: program.description,
    weeks: program.long.length,
    sport: program.cycle ? 'Cycling' : 'Running',
  })),
  {
    ...FOUNDATIONAL_RUNNING_PLAN_SUMMARY,
    sport: 'Running',
    weeks: FOUNDATIONAL_RUNNING_PLAN_SUMMARY.days / 7,
  },
];

const featuredIds = new Set(['first-run', 'first-ride', FOUNDATIONAL_RUNNING_PLAN_SUMMARY.id]);
export const FEATURED_TRAINING_PLANS = PUBLIC_TRAINING_PLANS.filter(plan => featuredIds.has(plan.id));
export const PUBLIC_TRAINING_PLANS_URL = '/' + PUBLIC_FEATURE_PATHS.trainingPlans;
export const PUBLIC_CATALOG_FRAGMENT = 'free-training-plans';

export function publicPlanFragment(id: string): string {
  return 'plan-' + id;
}
