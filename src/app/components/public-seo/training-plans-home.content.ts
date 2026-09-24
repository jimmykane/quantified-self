import type { CompactRowTone } from '../shared/compact-row/compact-row.component';
import type { PublicFeaturePreviewKey } from './public-feature-preview.types';
import { PUBLIC_FEATURE_PATHS } from './public-seo-pages.paths';

interface TrainingPlansHomeRow {
  icon: string;
  iconTone: CompactRowTone;
  title: string;
  copy: string;
}

/** Compact Training Plans discovery content rendered on the public homepage. */
export const TRAINING_PLANS_HOME_CONTENT = {
  title: 'Plan What Comes Next',
  intro: 'Build structured running, cycling, swimming, walking, hiking, rowing, or strength workouts, organize them into dated plans or keep them standalone, and choose how you want to manage and deliver them.',
  preview: 'training-plans' satisfies PublicFeaturePreviewKey,
  cta: {
    label: 'Explore Training Plans',
    routerLink: `/${PUBLIC_FEATURE_PATHS.trainingPlans}`,
    icon: 'edit_calendar',
  },
  rows: [
    {
      icon: 'event_available',
      iconTone: 'primary',
      title: 'Standalone or Dated Plans',
      copy: 'Start with one standalone workout, or organize multiple dated plans with one active plan, colors, skips, date shifting, and history.',
    },
    {
      icon: 'repeat',
      iconTone: 'secondary',
      title: 'Structured Workouts',
      copy: 'Build running, cycling, swimming, walking, hiking, or rowing sessions with intervals, or strength sessions with named exercises, sets, reps or timed holds, optional load, and rest.',
    },
    {
      icon: 'devices',
      iconTone: 'tertiary',
      title: 'Plan Through MCP',
      copy: 'With separate Training permissions, compatible MCP clients can read your schedule, assess provider compatibility, and prepare bounded plan, workout, or delivery changes for your approval.',
    },
    {
      icon: 'sync',
      iconTone: 'primary',
      title: 'Optional Provider Delivery',
      copy: 'Workout delivery to Garmin, Suunto, and Wahoo is available to connected Pro members through explicit plan opt-in or standalone Send actions, subject to sport compatibility. Pool and open-water swimming map to distinct Suunto Guide activities; Garmin supports compatible target-free pool swims, while Garmin open-water and Wahoo swim delivery are unavailable. Suunto can send strength as a Gym Guide with manual rep transitions, not native strength tracking. Garmin and Wahoo strength delivery is unsupported. New COROS plan sync and standalone Send actions are coming soon in the app. Connecting a provider never sends workouts by itself.',
    },
    {
      icon: 'calendar_month',
      iconTone: 'secondary',
      title: 'Separate Calendar Overlays',
      copy: 'See standalone and active-plan workouts beside completed activities without adding them to recorded totals or Training analysis.',
    },
  ] satisfies readonly TrainingPlansHomeRow[],
} as const;
