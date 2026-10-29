import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { DataFeeling, DataRPE } from '@sports-alliance/sports-lib';
import { dayWorkoutDateOffset, dayWorkoutLocalDate, dayWorkoutReadinessSourcesEnabled, type DayWorkoutControls } from '../../../shared/day-workout';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import { parseWorkoutStructureV1, type WorkoutTargetV1 } from '../../../shared/planned-workout';
import { parseTrainingPlanPhasesV1 } from '../../../shared/training-plans';
import { isStrengthWorkoutSportV1, parseStrengthWorkoutDetailsV1, strengthProjectionMatchesDetails } from '../../../shared/strength-workout';
import { createFirestoreTrainingReads } from '../mcp/training-plans.service';
import { collectDailyWorkoutContext } from './daily-workout-context';
import type { AssistantMcpSession, AssistantMcpToolName } from './mcp-session';
import type { PreviousStrengthPrescription } from './day-workout-validation';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record) : [];
function datedMetric(value: RecordValue, timeZone: string): RecordValue {
  const aggregation = record(value.aggregation);
  return { ...value, aggregation: { ...aggregation, buckets: records(aggregation.buckets).map(bucket => {
    const time = bucket.time ?? bucket.bucketKey;
    const localDate = typeof time === 'number' && Number.isFinite(time) ? dayWorkoutLocalDate(new Date(time), timeZone) : bucket.localDate;
    return { ...bucket, localDate };
  }) } };
}
export interface DayWorkoutContext {
  evidence: RecordValue;
  usedContext: string[];
  missingContext: string[];
  previousStrength: PreviousStrengthPrescription[];
  references: WorkoutTargetV1[];
}
export interface DayWorkoutTrainingContext {
  scheduleRevision: number;
  nearby: RecordValue[];
  phase: unknown;
  previousStrength: PreviousStrengthPrescription[];
  references: WorkoutTargetV1[];
  missing: string[];
}

/** Private, bounded summary reads; full strength companions are loaded only for five selected prescriptions. */
export async function readDayWorkoutTrainingContext(uid: string, controls: DayWorkoutControls, now: Date,
  db: FirebaseFirestore.Firestore = admin.firestore()): Promise<DayWorkoutTrainingContext> {
  if (!controls.trainingContext) throw new Error('Training context is disabled.');
  const reads = createFirestoreTrainingReads(() => db);
  const identity = 'first-party-assistant-v1:calendar-generation';
  const before = await reads.state(uid, identity);
  const today = dayWorkoutLocalDate(now, controls.timeZone);
  const collection = db.collection('users').doc(uid).collection('scheduledWorkouts');
  const query = (start: string, end: string) => collection.where('localDate', '>=', start).where('localDate', '<=', end)
    .orderBy('localDate').orderBy(FieldPath.documentId()).select('localDate', 'lifecycle', 'planId', 'title', 'revision', 'structure.sport').limit(401).get();
  const nearbyPage = await query(dayWorkoutDateOffset(controls.localDate, -7), dayWorkoutDateOffset(controls.localDate, 7));
  if (nearbyPage.size > 400) throw new Error('The nearby schedule could not be checked completely.');
  const nearbyRows = nearbyPage.docs.filter(doc => doc.get('lifecycle') !== 'deleted'
    && [null, before.activePlanId, controls.destinationPlanId].includes(doc.get('planId')));
  const missing: string[] = [];
  let priorIds: string[] = [];
  if (isStrengthWorkoutSportV1(controls.sport) && controls.usePreviousWeights) {
    const history = await query(dayWorkoutDateOffset(today, -27), dayWorkoutDateOffset(today, -1));
    if (history.size > 400) missing.push('Previous strength weights: history exceeds the bounded read.');
    else priorIds = history.docs.filter(doc => doc.get('lifecycle') === 'planned' && isStrengthWorkoutSportV1(doc.get('structure.sport')))
      .sort((a, b) => String(b.get('localDate')).localeCompare(String(a.get('localDate'))) || a.id.localeCompare(b.id))
      .slice(0, 5).map(doc => doc.id);
  }
  const result = await reads.snapshot(uid, async view => {
    const previousStrength: PreviousStrengthPrescription[] = [];
    const references: WorkoutTargetV1[] = [];
    const nearby: RecordValue[] = [];
    // Retain every schedule summary, but cap full prescription context independently.
    const ordered = [...nearbyRows].sort((a, b) => Math.abs(Date.parse(a.get('localDate')) - Date.parse(controls.localDate))
      - Math.abs(Date.parse(b.get('localDate')) - Date.parse(controls.localDate)));
    for (const [index, row] of ordered.entries()) {
      const item: RecordValue = { title: row.get('title'), localDate: row.get('localDate'), lifecycle: row.get('lifecycle'), sport: row.get('structure.sport') };
      if (index < 25) {
        const root = await view.get('scheduledWorkouts', row.id, true);
        if (!root || root.data.revision !== row.get('revision')) throw new Error('The schedule changed.');
        const structure = parseWorkoutStructureV1(root.data.structure);
        item.structure = structure;
        if (structure.sport === controls.sport) for (const node of structure.nodes) {
          for (const step of node.kind === 'step' ? [node] : node.steps) {
            references.push(...step.targets.filter(target => target.mode === 'relative'));
          }
        }
      }
      nearby.push(item);
    }
    if (nearbyRows.length > 25) missing.push('Only the nearest 25 scheduled prescriptions were read in full.');
    for (const workoutId of priorIds) {
      const root = await view.get('scheduledWorkouts', workoutId, true);
      const companion = await view.getStrengthDetails!(workoutId);
      if (!root || !companion) { missing.push('A previous strength prescription was unavailable.'); continue; }
      try {
        const details = parseStrengthWorkoutDetailsV1(companion.data);
        if (details.workoutId !== workoutId || details.revision !== root.data.revision
          || !strengthProjectionMatchesDetails(parseWorkoutStructureV1(root.data.structure), details)) throw new Error('Invalid companion.');
        previousStrength.push({ localDate: String(root.data.localDate), strength: { version: 1, exercises: details.exercises } });
      } catch { missing.push('A previous strength prescription could not be validated.'); }
    }
    let phase: unknown = null;
    if (controls.destinationPlanId) {
      const plan = await view.getPlanPhases!(controls.destinationPlanId);
      if (!plan || plan.data.lifecycle === 'archived') throw new Error('The selected plan is unavailable.');
      const phases = parseTrainingPlanPhasesV1(plan.data.phases ?? { version: 1, items: [] });
      phase = { planName: plan.data.name, lifecycle: plan.data.lifecycle,
        phase: phases.items.find(item => controls.localDate >= item.startLocalDate && controls.localDate <= item.endLocalDate) ?? null };
    }
    return { nearby, phase, previousStrength, references };
  });
  const after = await reads.state(uid, identity);
  if (before.revision !== after.revision || before.activePlanId !== after.activePlanId) throw new Error('The schedule changed. Generate again.');
  const references = result.references.filter(target => result.references
    .filter(other => other.kind === target.kind).every(other => other.mode === 'relative' && target.mode === 'relative'
      && JSON.stringify(other.reference) === JSON.stringify(target.reference)));
  if (references.length !== result.references.length) missing.push('Conflicting saved target references were omitted.');
  return { ...result, references, scheduleRevision: after.revision, missing: [...new Set(missing)] };
}

export async function collectDayWorkoutContext(controls: DayWorkoutControls, now: Date,
  session: Pick<AssistantMcpSession, 'callTool'>,
  readTraining: () => Promise<DayWorkoutTrainingContext>): Promise<DayWorkoutContext> {
  const usedContext: string[] = [];
  const missingContext: string[] = [];
  const readinessEnabled = controls.readinessContext !== false && dayWorkoutReadinessSourcesEnabled(controls);
  // Keep unchecked evidence out of the model, including duplicate vitals in the sleep summary.
  const selectReport = (value: RecordValue): RecordValue => {
    const readiness = record(value.readiness), drivers = record(readiness.drivers);
    const selectedDrivers = {
      ...(controls.freshnessContext !== false ? { load: drivers.load } : {}),
      ...(controls.sleepContext !== false ? { sleep: drivers.sleep } : {}),
      ...(controls.hrvContext !== false ? { hrv: drivers.hrv } : {}),
      ...(controls.overnightHeartRateContext !== false ? { overnightHeartRate: drivers.overnightHeartRate } : {}),
    };
    const sleep = record(value.sleep), latest = record(sleep.latestSession), vitals = record(latest.vitals);
    return {
      ...(controls.sleepContext !== false && value.sleep ? { sleep: { ...sleep,
        ...(sleep.latestSession ? { latestSession: { ...latest, ...(latest.vitals ? { vitals: {
          ...(controls.hrvContext !== false ? { averageHrvMs: vitals.averageHrvMs, overnightHrvMs: vitals.overnightHrvMs } : {}),
          ...(controls.overnightHeartRateContext !== false ? { averageHeartRateBpm: vitals.averageHeartRateBpm, minimumHeartRateBpm: vitals.minimumHeartRateBpm } : {}),
        } } : {}) } } : {}),
      } } : {}),
      readiness: { ...(readinessEnabled ? readiness : { status: 'disabled' }), drivers: selectedDrivers },
      ...(controls.activityContext !== false && value.trainingSummary ? { trainingSummary: value.trainingSummary } : {}),
    };
  };
  const read = async (name: AssistantMcpToolName, input: RecordValue): Promise<RecordValue> => {
    if (name === 'query_timeline_notes' && !controls.timelineContext) throw new Error('Timeline context is disabled.');
    if ((name === 'query_activities' || name === 'query_metric') && controls.activityContext === false) return {};
    if (name === 'prepare_training_metrics') {
      const metricKinds = [
        ...(controls.freshnessContext !== false ? [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.RampRate] : []),
        ...(controls.activityContext !== false ? [DERIVED_METRIC_KINDS.TrainingSummary] : []),
      ];
      if (!metricKinds.length) return { status: 'disabled', readyMetricKinds: [] };
      input = { ...input, metricKinds };
    }
    if (name === 'get_daily_report' && controls.freshnessContext === false && controls.hrvContext === false
      && controls.sleepContext === false && controls.overnightHeartRateContext === false && controls.activityContext === false) return {};
    try {
      const value = (await session.callTool(name, input)).structuredContent;
      if (name === 'get_daily_report') return selectReport(value);
      if (name === 'prepare_training_metrics') return { ...value,
        readyMetricKinds: Array.isArray(value.readyMetricKinds) ? value.readyMetricKinds.filter(kind => (input.metricKinds as unknown[]).includes(kind)) : [] };
      return name === 'query_metric' ? datedMetric(value, controls.timeZone) : value;
    }
    catch (error) {
      if (['query_planned_workouts_by_date', 'get_planned_workout_completions'].includes(name)) throw error;
      missingContext.push(name === 'query_timeline_notes' ? 'Timeline notes could not be checked completely.'
        : name === 'query_activities' ? 'Today’s recorded activities could not be checked completely.'
        : 'Some recorded Training or recovery evidence is unavailable.');
      return {};
    }
  };
  const daily = await collectDailyWorkoutContext({ now, timeZone: controls.timeZone,
    timelineNotesEnabled: controls.timelineContext, trainingPlansEnabled: controls.trainingContext, read,
    request: { targetDate: controls.localDate, hypotheticalWithoutPlan: false, noAdditionalWorkoutToday: false } });
  // Reuse Assistant's validated report, filtered by this draft's independent data choices.
  const report = daily.dailyReport;
  const readiness = record(report.readiness);
  const drivers = record(readiness.drivers);
  const load = record(drivers.load);
  const hasNumber = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);
  const describe = (available: boolean, label: string, missing: string, enabled = true) => {
    if (!enabled) { missingContext.push(`${label}: turned off.`); return; }
    (available ? usedContext : missingContext).push(available ? label : missing);
  };
  describe(load.status === 'available' && hasNumber(load.form),
    'Current freshness (Form)', 'Current freshness (Form) is unavailable.', controls.freshnessContext !== false);
  describe(load.status === 'available' && hasNumber(load.rampRate),
    'Current training load ramp rate', 'Current training load ramp rate is unavailable.', controls.freshnessContext !== false);
  describe(records(record(record(daily.trainingSnapshots.form).payload).dailyLoads).length > 0,
    'Training load history', 'Training load history is unavailable.', controls.freshnessContext !== false);
  describe(record(report.trainingSummary).status === 'available',
    'Training summary: recent 28 days and usual volume', 'The current 28-day Training summary is unavailable.', controls.activityContext !== false);
  describe(readiness.status === 'available' && hasNumber(readiness.score),
    `Readiness observed on ${daily.localDate}`, 'Current readiness is unavailable.', readinessEnabled);
  describe(record(report.sleep).status === 'available',
    'Recent sleep', 'Recent sleep is unavailable.', controls.sleepContext !== false);
  const hrv = record(record(drivers.hrv).personalRange);
  const hasHrv = hasNumber(hrv.latestMs);
  describe(hasHrv, 'Recorded HRV', 'Recent HRV is unavailable.', controls.hrvContext !== false);
  if (hasHrv) {
    if (hrv.reason === 'building_baseline') missingContext.push('HRV personal baseline is still building.');
    else if (hrv.reason === 'insufficient_current') missingContext.push('HRV has too few recent observations for a personal-range comparison.');
    else usedContext.push('HRV compared with your personal range');
  }
  const overnightHeartRate = record(drivers.overnightHeartRate);
  describe(overnightHeartRate.status === 'available' || overnightHeartRate.status === 'insufficient_baseline',
    'Recorded overnight heart rate', 'Recent overnight heart rate is unavailable.', controls.overnightHeartRateContext !== false);
  if (overnightHeartRate.status === 'available') usedContext.push('Overnight heart rate compared with your personal baseline');
  else if (overnightHeartRate.status === 'insufficient_baseline') missingContext.push('Overnight heart rate has too little baseline history for comparison.');
  if (controls.activityContext === false) missingContext.push('Recent activities: turned off.');
  else if (daily.activitiesToday.scanComplete) usedContext.push('Today’s recorded activities');
  if (!controls.timelineContext) missingContext.push('Timeline notes: access is off.');
  else if (daily.timelineNotes.scanComplete) usedContext.push('Existing Timeline notes, with their actual dates');
  else missingContext.push('Timeline notes could not be checked completely.');
  let training: DayWorkoutTrainingContext | null = null;
  if (controls.trainingContext) {
    if (!daily.plannedWorkouts.scanComplete || !daily.plannedWorkouts.completionChecked) throw new Error('The selected day’s schedule could not be checked completely.');
    training = await readTraining();
    if (training.scheduleRevision !== daily.plannedWorkouts.scheduleRevision) throw new Error('The schedule changed. Generate again.');
    usedContext.push('Selected-day schedule and completion links; nearby sessions within seven days');
    if (training.phase) usedContext.push('Selected plan and phase');
    if (training.previousStrength.length) usedContext.push('Up to five previous planned strength prescriptions');
    missingContext.push(...training.missing);
  } else missingContext.push('Training plan context and previous weights: access is off.');
  const feedbackResult = controls.feedbackContext === false ? {} : await read('query_metrics', {
    metrics: [DataFeeling.type, DataRPE.type].flatMap(metric => [{ metric, aggregation: 'minimum' }, { metric, aggregation: 'maximum' }]),
    start: `${dayWorkoutDateOffset(daily.windowStartDate, -1)}T00:00:00Z`, end: now.toISOString(), groupBy: 'date', interval: 'daily', timeZone: controls.timeZone,
  });
  const feedback = { results: records(feedbackResult.results).map(value => {
    const normalized = datedMetric(value, controls.timeZone);
    return { metric: value.metric, aggregation: { ...record(normalized.aggregation),
      buckets: records(record(normalized.aggregation).buckets).filter(bucket => Number(bucket.totalCount) > 0
        && typeof bucket.aggregateValue === 'number' && Number.isFinite(bucket.aggregateValue)
        && typeof bucket.localDate === 'string' && bucket.localDate >= daily.windowStartDate && bucket.localDate <= daily.localDate) } };
  }) };
  if (controls.feedbackContext === false) missingContext.push('Existing Feeling/RPE feedback: turned off.');
  else if (feedback.results.some(result => result.aggregation.buckets.length > 0)) {
    usedContext.push('Existing recording-level Feeling/RPE ranges; imported and QS-edited values are not distinguished');
  } else missingContext.push('No usable existing Feeling/RPE feedback was found.');
  const selectedDaily: RecordValue = { ...daily };
  if (controls.activityContext === false) { delete selectedDaily.weekdayConsistency; delete selectedDaily.activitiesToday; }
  const evidence: RecordValue = { daily: selectedDaily, ...(controls.feedbackContext !== false ? { feedback } : {}), nearby: training?.nearby ?? null, phase: training?.phase ?? null,
    previousStrength: training?.previousStrength ?? [], references: training?.references ?? [] };
  if (JSON.stringify(evidence).length > 160_000) throw new Error('The context exceeds the safe generation limit. Try a simpler selection.');
  return { evidence, usedContext, missingContext: [...new Set(missingContext)],
    previousStrength: training?.previousStrength ?? [], references: training?.references ?? [] };
}
