import type { CompactRowTone } from '../shared/compact-row/compact-row.component';
import type { PublicFeaturePreviewKey } from './public-feature-preview.types';
import { PUBLIC_FEATURE_PATHS } from './public-seo-pages.paths';

interface TrainingPlansHomeRow {
  icon: string;
  iconTone: CompactRowTone;
  title: string;
  copy: string;
}

export const TRAINING_PLANS_PREVIEW_KEY: PublicFeaturePreviewKey = 'training-plans';

/** Compact Training Plans discovery content rendered on the public homepage. */
export const TRAINING_PLANS_HOME_CONTENT = {
  title: 'Plan What Comes Next',
  intro: 'Create free manual running and cycling plans or schedule one standalone structured workout. No provider connection is required, and planned workouts stay separate from completed activity totals.',
  preview: TRAINING_PLANS_PREVIEW_KEY,
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

/** Concise metadata shared by the public Training Plans route and its structured data. */
export const TRAINING_PLANS_SEO_CONTENT = {
  title: 'Training Plans for Running and Cycling',
  description: 'Create free running and cycling training plans or standalone structured workouts, schedule them by date, and keep them separate from completed activities.',
  h1: 'Plan running and cycling workouts your way',
  intro: 'Create a dated plan or start with one standalone workout. Manual planning is free, works without a provider connection, and keeps what you intend to do separate from the activities you already completed.',
  featureList: [
    'Free manual running and cycling training plans',
    'Standalone structured workouts without a plan',
    'Dated plan calendars with colors, history, and shifting',
    'Planned-workout overlays kept separate from completed activity totals',
  ],
  socialImageAlt: 'Synthetic purple running and cycling training plan calendar with structured workout examples',
  freeOfferDescription: 'Manual training plans and standalone structured workouts',
} as const;
