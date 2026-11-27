import type { McpStarterQuestionId } from '../mcp-connections/mcp-starter-questions';

interface Example {
  question: McpStarterQuestionId;
  title: string;
  source: string;
  result: string;
  detail: string;
  images?: { file: string; width: number; height: number; alt: string; caption: string }[];
}

export const GUIDE_EXAMPLE_GROUPS: { id: string; label: string; title: string; examples: Example[] }[] = [
  {
    id: 'ride-and-race', label: 'Rides & races', title: 'Read a ride or debrief a race',
    examples: [
      {
        question: 'ride', title: 'What made a 13 km ride so demanding?', source: 'Garmin Edge MTB recording',
        result: '765 m of climbing in 12.99 km',
        detail: 'The rider was moving for 48 min 47 s of a 1 h 41 min 59 s recording. Heart rate averaged 144 bpm. Those figures describe a short, steep ride even without a power meter.',
        images: [{ file: 'garmin-ride', width: 1370, height: 632, alt: 'Garmin mountain bike ride in QS, with elapsed and moving time above the heart-rate zones.', caption: 'The QS activity view separates moving time from total duration.' }],
      },
      {
        question: 'race', title: 'Did the harder race show up in the power data?', source: 'Race recording · Garmin and Suunto',
        result: '169 W vs 151 W',
        detail: 'The rider averaged 169 W over 80.58 km and 1,795 m of climbing. On the earlier ride they averaged 151 W, while average heart rate differed by just one beat, 162 vs 161 bpm. The routes differed, so the comparison leaves the fitness question open.',
        images: [{ file: 'race-metrics', width: 1370, height: 391, alt: 'QS race summary showing 169 W average power, 191 W normalized power and 1,795 m of ascent.', caption: 'The race took 3 h 27 min 43 s. QS reports normalized power of 191 W.' }],
      },
    ],
  },
  {
    id: 'training-and-sleep', label: 'Training & sleep', title: 'Put a training block in context',
    examples: [
      {
        question: 'build', title: 'Was the bigger training block more consistent?', source: 'From an earlier ChatGPT conversation',
        result: '74.5 hours across 6 active weeks',
        detail: 'The other eight-week block totaled 53.1 hours, with training in all eight weeks. The larger block also carried more load, about 2,960 vs 2,250 TSS. Looking at active weeks reveals how concentrated that work was.',
        images: [{ file: 'training-build', width: 580, height: 613, alt: 'Original ChatGPT table comparing total load, training hours and active weeks across two eight-week blocks.', caption: 'The figures come from the August conversation. The comparison covers the athlete’s recorded training across devices.' }],
      },
      {
        question: 'sleep', title: 'How did last night compare with the previous seven?', source: 'Illustrative sleep example',
        result: '30 ms vs a 40 ms HRV baseline',
        detail: 'Suppose sleeping heart rate also averaged 64 bpm against a usual 60. Ask how many nights contributed to each baseline and which device recorded them. These numbers are invented to illustrate the question. You can try it with Sleep access and your own recorded nights.',
      },
    ],
  },
  {
    id: 'activity-history', label: 'Activity history', title: 'Find patterns in your activity history',
    examples: [
      {
        question: 'chart', title: 'What temperature did my device record on swims?', source: 'From an earlier ChatGPT conversation',
        result: '175 of 199 activities had a temperature',
        detail: 'ChatGPT plotted the reported average temperature by year for swims and snorkelling. The 2020 season had no qualifying records and 2026 stopped in August. The devices reported activity temperature. The chart alone cannot establish water temperature.',
        images: [{ file: 'swim-temperature', width: 790, height: 545, alt: 'Historical chart of device-reported activity temperature in degrees Celsius, with a gap in 2020 and a partial 2026.', caption: 'The counts and annual averages are from the original chart.' }],
      },
      {
        question: 'tags', title: 'Can I find races by series and result?', source: 'Earlier conversation · one race checked in QS',
        result: '8 tags on one race',
        detail: 'The athlete wanted to keep their race and series labels while adding placings. One checked activity retained those labels and marked the result provisional. To organize your own history, ask for a preview of the exact tag changes before approving an edit.',
      },
    ],
  },
  {
    id: 'workout-planning', label: 'Workout planning', title: 'Take a workout from draft to device',
    examples: [
      {
        question: 'workout', title: 'What will I ride, and did it reach my Garmin?', source: 'Illustrative draft and separate historical request',
        result: '5 min warm-up · 20 min easy · 5 min cool-down',
        detail: 'The 30-minute example stayed a draft. In a separate conversation, the athlete approved a Garmin delivery request for an existing 40-minute Easy Recovery Spin. The last recorded state was queued. Receipt on the watch was never confirmed.',
        images: [
          { file: 'workout-draft', width: 800, height: 398, alt: 'Illustrative three-step cycling workout with a five-minute warm-up, twenty-minute main ride and five-minute cool-down.', caption: 'Illustrative 30-minute draft. The athlete did not save or send it.' },
          { file: 'garmin-delivery', width: 794, height: 650, alt: 'Earlier ChatGPT response showing a queued Garmin delivery request for a 40-minute Easy Recovery Spin.', caption: 'Separate 40-minute workout. The conversation records a delivery request.' },
        ],
      },
    ],
  },
];

export const FOLLOW_UP_QUESTIONS = [
  { question: 'laps', title: 'Which climb did I pace best?' },
  { question: 'history', title: 'When did I first record heart rate on a swim?' },
  { question: 'notes', title: 'What did I write during that training block?' },
  { question: 'measurements', title: 'How has my recorded weight changed?' },
] as const satisfies readonly { question: McpStarterQuestionId; title: string }[];
