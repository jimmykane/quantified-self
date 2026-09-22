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
  intro: 'Build structured running and cycling workouts, organize them into dated plans or keep them standalone, and choose how you want to manage and deliver them.',
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
      title: 'Structured Running and Cycling',
      copy: 'Combine time or distance steps, fixed repeats, and absolute heart-rate, power, or pace targets in a clear workout editor.',
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
      copy: 'Wahoo workout delivery is available to connected Pro members through explicit plan opt-in or standalone Send actions. Garmin, Suunto, and COROS delivery remain limited rollouts. Connecting a provider never sends workouts by itself.',
    },
    {
      icon: 'calendar_month',
      iconTone: 'secondary',
      title: 'Separate Calendar Overlays',
      copy: 'See standalone and active-plan workouts beside completed activities without adding them to recorded totals or Training analysis.',
    },
  ] satisfies readonly TrainingPlansHomeRow[],
} as const;
