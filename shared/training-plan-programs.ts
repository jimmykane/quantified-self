export type TrainingProgram = {
  id: string; version: number; name: string; description: string; cycle?: boolean; fourth?: boolean;
  easy: number; steady: number; long: number[]; finishMeters?: number;
};
export const TRAINING_PROGRAMS: TrainingProgram[] = [
  { id: 'first-run', version: 1, name: 'First 30-Minute Run', description: 'For walkers comfortable with a 30-minute walk. Build toward running continuously at a conversational effort.',
    easy: 20, steady: 20, long: [20,22,24,20,25,26,24,28,30] },
  { id: 'first-ride', version: 1, name: 'First 50 km Ride', description: 'For riders comfortable on a bike for 30 minutes. Build toward a first 50 km outing.',
    cycle: true, easy: 25, steady: 30, long: [35,45,55,40,65,80,95,100], finishMeters: 50000 },
  { id: '5k', version: 1, name: '5K Race', description: 'For runners already comfortable running continuously for 25 minutes, three days per week.',
    easy: 20, steady: 25, long: [30,32,35,28,38,40,32,30], finishMeters: 5000 },
  { id: '10k', version: 1, name: '10K Race', description: 'For runners already running three days a week with a comfortable 40-minute long run.',
    easy: 25, steady: 30, long: [40,42,46,38,50,55,46,60,45,55], finishMeters: 10000 },
  { id: 'half', version: 1, name: 'Half Marathon', description: 'For regular runners with a comfortable hour-long run and three running days each week.',
    easy: 35, steady: 40, long: [60,65,70,55,75,80,85,65,90,100,75,100], finishMeters: 21097.5 },
  { id: 'marathon', version: 1, name: 'Marathon', description: 'For experienced runners already running four days weekly, including a comfortable 90-minute long run.',
    fourth: true, easy: 40, steady: 45, long: [90,95,105,85,110,115,125,95,135,140,110,145,155,120,165,125,85,180], finishMeters: 42195 },
  { id: '100k', version: 1, name: '100 km Cycling Event', description: 'For riders already riding three days weekly, including a comfortable 90-minute ride.',
    cycle: true, easy: 45, steady: 50, long: [90,100,110,85,120,135,105,145,160,180,120,180], finishMeters: 100000 },
];

// Publication credit for the licensed edition in foundational-running-plan.ts.
const attribution = {
  title: 'Build-up a foundational running base',
  originalAuthor: 'Felix Gertz',
  sourceUrl: 'https://plans.tredict.com/en/plan/Buildup_a_foundational_running_base/zoySQCnLM',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  changes: 'Quantified Self adapted the titles and coaching cues, converted the sessions into workout steps, and kept the original day spacing. Heart-rate and threshold-pace guidance is rounded and shown in step notes. Device target bands and example athlete values are omitted.',
  notice: 'This is an example plan for the Tredict training plans publishing feature.',
};

export const FOUNDATIONAL_RUNNING_PLAN_SUMMARY = {
  id: 'tredict-running-base', attribution,
  name: attribution.title, author: attribution.originalAuthor, days: 28,
  description: 'For runners returning after a break. Use a heart-rate monitor for the easy efforts. Four weeks progress from a 20-minute run to a 90-minute outing, with short strides and a threshold-pace session.',
};
