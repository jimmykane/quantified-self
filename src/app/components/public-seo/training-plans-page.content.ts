import { TRAINING_PLANS_PREVIEW_KEY } from './training-plans-feature.content';

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
    preview: TRAINING_PLANS_PREVIEW_KEY,
  },
  {
    eyebrow: 'Structured Workouts',
    title: 'Build the running and cycling workout you mean',
    copy: 'The first manual editor supports the current Running and Cycling families with date-only scheduling, time or distance steps, fixed repeats, and one absolute heart-rate, power, or pace target per step.',
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
        icon: 'repeat',
        title: 'Clear limits, predictable recipes',
        copy: 'Use up to 100 total nodes, fixed repeat counts up to 100, no nested repeats, and one supported absolute target per step in the current manual editor.',
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
