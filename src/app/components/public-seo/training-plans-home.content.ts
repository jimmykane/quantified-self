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
  intro: 'Create free manual running and cycling plans or schedule one standalone structured workout. No provider connection is required, and planned workouts stay separate from completed activity totals.',
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
      copy: 'Combine time or distance steps, fixed repeats, and absolute heart-rate, power, or pace targets in the manual editor.',
    },
    {
      icon: 'calendar_month',
      iconTone: 'tertiary',
      title: 'Separate Calendar Overlays',
      copy: 'See standalone and active-plan workouts beside completed activities without adding them to recorded totals or Training analysis.',
    },
  ] satisfies readonly TrainingPlansHomeRow[],
} as const;
