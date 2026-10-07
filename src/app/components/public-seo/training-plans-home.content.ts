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
  intro: 'Build your next workout, save your favorites, and organize your plan into named phases. Plan for running, cycling, swimming, walking, hiking, rowing, or strength.',
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
      copy: 'Start with one standalone workout, or organize dated plans with phases such as Base, Build, Recovery, or Taper. Use your own names, dates, and colors, with date shifting and history.',
    },
    {
      icon: 'repeat',
      iconTone: 'secondary',
      title: 'Build and See Your Workout',
      copy: 'See your interval profile as you build. Set time, distance, or lap-ended steps, add repeats and heart-rate, power, pace, or cadence targets, then reorder or duplicate blocks. For strength, build exercises, sets, reps or holds, load, and rest.',
    },
    {
      icon: 'library_books',
      iconTone: 'tertiary',
      title: 'Save It. Use It Again.',
      copy: 'Keep favorite sessions in your Workout Library. Add a saved workout to one date or repeat it across selected days, in a plan or on its own. Each scheduled copy stays independent.',
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
      copy: 'Send compatible workouts to Garmin, Suunto, or Wahoo with Pro. Choose a plan to sync or send a workout on its own.',
    },
    {
      icon: 'calendar_month',
      iconTone: 'secondary',
      title: 'Separate Calendar Overlays',
      copy: 'See standalone workouts, active-plan workouts, and phase labels beside completed activities without adding them to recorded totals or Training analysis.',
    },
  ] satisfies readonly TrainingPlansHomeRow[],
} as const;
