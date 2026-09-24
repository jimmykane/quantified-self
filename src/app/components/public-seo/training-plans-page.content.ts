import type { PublicFeaturePreviewKey } from './public-feature-preview.types';

/** Concise metadata shared by the public Training Plans route and its structured data. */
export const TRAINING_PLANS_SEO_CONTENT = {
  title: 'Training Plans for Running, Cycling & More',
  description: 'Create free running, cycling, swimming, walking, hiking and rowing plans or standalone workouts. Schedule by date, separate from completed activities.',
  h1: 'Plan workouts for running, cycling, swimming and more',
  intro: 'Build a dated plan or start with one standalone workout. Work directly in Quantified Self, keep scheduled work separate from completed activities, and connect other tools only when you choose.',
  featureList: [
    'Running, cycling, swimming, walking, hiking, rowing and strength plans included on the free tier',
    'Standalone structured workouts without a plan',
    'Dated plan calendars with colors, history, and shifting',
    'Planned-workout overlays kept separate from completed activity totals',
  ],
  socialImageAlt: 'Synthetic purple running and cycling training plan calendar with structured workout examples',
  freeOfferDescription: 'Training plans and standalone structured workouts created in Quantified Self',
} as const;

/** Long-form Training Plans sections loaded with the public feature-page content. */
export const TRAINING_PLANS_PAGE_SECTIONS = [
  {
    eyebrow: 'Plan or Standalone',
    title: 'Plan with or without a training plan',
    copy: 'A standalone workout is first-class: create it without a plan, then attach it later if your schedule grows. Keep multiple dated plans, with one active at a time for calendar overlays, and leave the others available in Training Plans.',
    items: [
      {
        icon: 'event_available',
        title: 'Standalone when that is all you need',
        copy: 'Schedule one workout by date without creating a plan. Move the same workout into a plan later without replacing its identity.',
      },
      {
        icon: 'calendar_month',
        title: 'Multiple plans, one active calendar',
        copy: 'Create multiple dated plans and keep one active at a time. Active-plan and standalone workouts appear on calendar surfaces; inactive plans remain in Training Plans.',
      },
      {
        icon: 'palette',
        title: 'Dates, colors, skips, shifts, and history',
        copy: 'Give each plan a color, select any date in its range, keep skipped workouts visible, shift the plan dates, and use revision history when a change needs to be restored.',
      },
    ],
    preview: 'training-plans' satisfies PublicFeaturePreviewKey,
  },
  {
    eyebrow: 'Structured Workouts',
    title: 'Build the workout you mean',
    copy: 'The interval editor supports running, cycling, pool and open-water swimming, walking, hiking, rowing and indoor rowing with date-only scheduling, time or distance steps, fixed repeats, and one absolute heart-rate, power, or pace target per step. The separate strength editor supports ordered named exercises, individual sets with repetitions or timed holds, optional external load in kilograms, and optional rest after each set. Swim and rowing distance steps use metres. Rowing pace is a 500 m split; swim pace follows your /100 m or /100 yd setting. Pool workouts can store an optional physical pool length in metres or yards, separately from step distance; open-water workouts have no pool length.',
    items: [
      {
        icon: 'directions_run',
        title: 'Running sports',
        copy: 'Create Running, Trail Running, and Treadmill workouts with warmup, work, recovery, cooldown, rest, or other steps.',
      },
      {
        icon: 'directions_bike',
        title: 'Cycling sports',
        copy: 'Create Cycling, Mountain Biking, Indoor Cycling, E-Biking, and Hand Cycle workouts using the same structure.',
      },
      {
        icon: 'pool',
        title: 'Pool and open-water swimming',
        copy: 'Create either Swimming or Open Water Swimming workouts with metre-based distance steps or timed steps. Suunto uses the matching Guide activity. Garmin supports compatible target-free pool swims with an optional pool length, but not open water; Wahoo swim delivery and COROS open-water delivery are unavailable. A Garmin cloud check is not proof of watch receipt.',
      },
      {
        icon: 'hiking',
        title: 'Walking, hiking, and rowing',
        copy: 'Create Walking, Hiking, Rowing, or Indoor Rowing workouts. Suunto Guides recommend the matching exercise profile. Garmin, COROS, and Wahoo structured-workout delivery for these sports is unsupported under their current contracts. Guide acceptance does not prove app or watch visibility.',
      },
      {
        icon: 'fitness_center',
        title: 'Strength training',
        copy: 'Build ordered exercises and sets with reps or timed holds, optional external load in kilograms, and rest. Suunto sends a degraded Gym Guide with manual rep transitions, never native strength tracking; Garmin and Wahoo delivery is unsupported. COROS strength remains Coming soon pending account proof.',
      },
      {
        icon: 'repeat',
        title: 'Clear limits, predictable recipes',
        copy: 'Use up to 100 total nodes, fixed repeat counts up to 100, no nested repeats, and one supported absolute target per step in the current editor.',
      },
    ],
  },
  {
    eyebrow: 'Calendar Context',
    title: 'Keep planned work separate from completed training',
    copy: 'Planned workouts are an overlay, not completed evidence. Every calendar date remains selectable, while planned and completed entries retain separate meaning and actions.',
    items: [
      {
        icon: 'event_note',
        title: 'Visible across calendar surfaces',
        copy: 'See standalone and active-plan workouts on the main Calendar, dashboard Activity Calendar tile, and Today mini-calendar. Skipped workouts remain visible and marked.',
      },
      {
        icon: 'calculate',
        title: 'Completed totals remain unchanged',
        copy: 'A planned workout never adds distance, duration, ascent, load, or workout count to completed-activity totals.',
      },
      {
        icon: 'monitoring',
        title: 'Training analysis uses recorded evidence',
        copy: 'Training analysis continues to use imported or uploaded completed activities. A plan does not become completed training until a recorded activity exists.',
      },
    ],
  },
] as const;
