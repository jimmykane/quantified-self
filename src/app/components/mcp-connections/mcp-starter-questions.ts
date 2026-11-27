export const MCP_STARTER_QUESTIONS = {
  training: { title: 'Compare my training', text: 'Compare my last four weeks of training with the previous twelve. Show sessions and hours per four weeks for each sport I recorded. Where did my training change most?' },
  race: { title: 'Debrief a race', text: 'Help me debrief a race. Ask which race I mean, then compare it with a similar ride. Where did my effort change? Use recorded laps, heart rate and power where available, and flag differences in terrain.' },
  laps: { title: 'Compare laps or climbs', text: 'Help me choose a workout with recorded laps or repeated climbs. Compare their duration, elevation and available heart rate or power. Which efforts are comparable?' },
  cycling: { title: 'Compare my rides', text: 'Compare my last four weeks of cycling with the previous twelve. Show rides and hours per four weeks, average minutes per ride, and which recording devices you can identify. If the device is unknown, say so.' },
  ride: { title: 'Read one ride', text: 'Walk me through this ride. How much of the recorded time was I moving, how much did I climb, and what does my heart rate add? Separate recorded metrics from modeled training load.' },
  build: { title: 'Compare two training blocks', text: 'Compare my last eight weeks with an earlier eight-week build. Explain why you picked it. Show hours, training load, active weeks and any gaps in the data.' },
  sleep: { title: 'Check a sleep baseline', text: 'Compare my latest main sleep with the previous seven nights. Show HRV, average sleeping heart rate and duration where recorded. Which device and how many nights contributed to each average?' },
  history: { title: 'Find an early swim', text: 'Find my earliest swims with recorded heart rate. Show the dates and available device names. How far back do my recordings go?' },
  chart: { title: 'Chart my swim history', text: 'Plot average reported activity temperature by year for my swims and snorkelling. Show how many activities have that metric, which years are partial, and what the device actually measured.' },
  tags: { title: 'Organize race tags', text: 'Find my race-tagged activities and suggest consistent tags. Preserve existing tags and flag provisional results. Show the exact changes so I can review them before anything is applied.' },
  notes: { title: 'Read my Timeline notes', text: 'Look up my Timeline notes for this training block. Put what I wrote beside the recorded workload for those weeks, and distinguish my observations from measured values. Leave the notes as they are.' },
  measurements: { title: 'Review weight measurements', text: 'Show my recorded weight trend over the last 28 days, including units, measurement dates and gaps. How many measurements support the trend?' },
  workout: { title: 'Draft a workout', text: 'Draft an easy 30-minute ride and show each step. Let me review the workout before saving it. Ask separately before requesting delivery to my connected device, then tell me which delivery state QS reports.' },
} as const;

export type McpStarterQuestionId = keyof typeof MCP_STARTER_QUESTIONS;
export const QUICK_QUESTION_IDS = ['training', 'race', 'laps'] as const satisfies readonly McpStarterQuestionId[];
