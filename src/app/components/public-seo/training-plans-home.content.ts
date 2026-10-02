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
  mcpExample: {
    title: 'Create Today\'s Workout with Your Training Data and Notes',
    prompt: 'Propose one standalone workout for today using my available HRV, sleep, overnight heart rate, readiness, and recent training load. Check my Timeline notes for illness, injury, stress, travel, or vacation. Consider my usual training pattern for this day of the week, alongside recent completed activities and planned workouts, so the session fits my routine without duplicating training. Explain why it suits today, flag missing information, and show me the duration, intensity, and workout steps before adding anything. If recovery or rest is more appropriate, say so.',
  },
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
      title: 'Send Your Workouts',
      copy: 'Send compatible workouts to Garmin, Suunto, or Wahoo with Pro. Choose a plan to sync or send a workout on its own. Connecting an account alone won’t send planned workouts. Support varies by sport and device. COROS is coming soon.',
    },
    {
      icon: 'calendar_month',
      iconTone: 'secondary',
      title: 'Separate Calendar Overlays',
      copy: 'See standalone and active-plan workouts beside completed activities without adding them to recorded totals or Training analysis.',
    },
  ] satisfies readonly TrainingPlansHomeRow[],
} as const;
