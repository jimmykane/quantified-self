import type { PublicSeoSection } from './public-seo-pages.content';

export const DAILY_WORKOUT_PRO_BENEFIT = 'One included daily workout suggestion';

/** Shared public explanation; generation and saving always remain in the signed-in app. */
export const WORKOUT_GENERATION_SECTION = {
  eyebrow: 'AI Workout Generation',
  title: 'A workout that fits today',
  copy: 'Generate a workout from Calendar or New Workout using your selected recovery, training and Timeline context. Pro members can opt in to a daily suggestion when they open Today. Review a workout or rest day before adding it.',
  items: [
    { icon: 'auto_awesome', title: 'Generate with your context',
      copy: 'Choose your sport, available time and equipment. Include sleep, HRV, freshness, readiness, recent training, recorded weekday routine and Timeline notes. Missing data stays visible. Manual generation uses your shared Assistant allowance.' },
    { icon: 'today', title: 'An included daily suggestion with Pro',
      copy: 'Opt in from Dashboard Today. QS prepares up to one included suggestion per local day when you visit, separately from your Assistant allowance. It respects existing planned workouts, recorded activities and rest days, and can wait for sleep or use available data when you choose.' },
    { icon: 'fact_check', title: 'Review, add, then send',
      copy: 'Inspect the workout steps and context, edit the draft, or mark a suggested rest day. Nothing is added without your choice. Review compatible provider delivery with Pro after saving. Generation alone never sends a workout; existing plan sync can apply after you save.' },
  ],
  preview: 'daily-workout',
} satisfies PublicSeoSection;
