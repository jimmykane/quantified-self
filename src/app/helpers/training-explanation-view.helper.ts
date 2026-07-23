import type {
  DerivedTrainingExplanationMetricPayload,
  DerivedTrainingExplanationRhythm,
  DerivedTrainingExplanationSportLoad,
} from '@shared/derived-metrics';
import { isGenericTrainingEventLabel } from './training-event-label.helper';

export type TrainingExplanationTone = 'positive' | 'negative' | 'neutral';
export interface TrainingExplanationCardViewModel {
  key: 'load' | 'contributors' | 'mix' | 'rhythm';
  title: string;
  valueText: string;
  description: string;
  descriptionItems?: readonly string[];
  tone: TrainingExplanationTone;
}
export interface TrainingExplanationViewModel {
  cards: TrainingExplanationCardViewModel[];
  conclusionText: string;
  evidenceText: string;
  nextStepText: string | null;
  coverageText: string;
}

export function buildTrainingExplanationViewModel(
  payload: DerivedTrainingExplanationMetricPayload | null | undefined,
): TrainingExplanationViewModel | null {
  if (!payload) {
    return null;
  }
  const { current, baselineMedian } = payload;
  const currentLoad = current.parentTrainingStressScore;
  const usualLoad = baselineMedian.parentTrainingStressScore;
  const cards: TrainingExplanationCardViewModel[] = [{
    key: 'load',
    title: 'Overall load',
    valueText: formatLoadOutcome(currentLoad, usualLoad),
    description: currentLoad === null
      ? `No TSS is available for this 28-day window (${current.parentLoadEventCount}/${current.parentEventCount} workouts with load).`
      : `${formatNumber(currentLoad)} TSS across ${current.parentEventCount} workouts${usualLoad === null ? '; the usual load baseline is unavailable.' : `. The usual 28-day median is ${formatNumber(usualLoad)} TSS.`}`,
    tone: 'neutral',
  }];

  if (payload.topContributors.length) {
    const contributors = payload.topContributors.slice(0, 3);
    const descriptionItems = contributors.map((item) => {
      const leadingChild = [...item.childComposition]
        .filter(child => child.loadSharePercent !== null)
        .sort((left, right) => (right.loadSharePercent || 0) - (left.loadSharePercent || 0))[0];
      const usesContextFallback = isGenericTrainingEventLabel(item.label);
      const label = usesContextFallback
        ? `${leadingChild?.label || 'Workout'} · ${formatShortUtcDate(item.startDayMs)}`
        : item.label!;
      return `${label} (${formatNumber(item.loadSharePercent)}%${leadingChild && !usesContextFallback ? `; mostly ${leadingChild.label.toLowerCase()}` : ''})`;
    });
    cards.push({
      key: 'contributors',
      title: 'Top contributors',
      valueText: `${formatNumber(contributors.reduce((sum, item) => sum + item.loadSharePercent, 0))}% of load`,
      description: descriptionItems.join(' · '),
      descriptionItems,
      tone: 'neutral',
    });
  }

  const sportDriver = resolveSportLoadDriver(current.sportLoads, baselineMedian.sportLoads);
  if (sportDriver) {
    cards.push({
      key: 'mix',
      title: `${sportDriver.label} load`,
      valueText: formatLoadOutcome(sportDriver.currentTss, sportDriver.usualTss),
      description: `${formatNumber(sportDriver.currentTss)} TSS now; the usual 28-day median is ${formatNumber(sportDriver.usualTss)} TSS. ${sportDriver.currentActivities} workouts now; ${sportDriver.usualActivities} usual.`,
      tone: 'neutral',
    });
  }

  const rhythmDriver = resolveRhythmDriver(current.rhythms, baselineMedian.rhythms);
  if (rhythmDriver) {
    const delta = rhythmDriver.current.activeDayCount - rhythmDriver.usual.activeDayCount;
    cards.push({
      key: 'rhythm',
      title: `${formatDiscipline(rhythmDriver.current.discipline)} rhythm`,
      valueText: formatRhythmOutcome(delta),
      description: `${rhythmDriver.current.sessionCount} workouts across ${rhythmDriver.current.activeWeekCount} active weeks. Longest inactivity gap: ${formatDayCount(rhythmDriver.current.longestInactivityGapDays)}; usual is ${formatDayCount(rhythmDriver.usual.longestInactivityGapDays)}.`,
      tone: 'neutral',
    });
  }

  return {
    cards,
    conclusionText: buildConclusion(currentLoad, usualLoad),
    evidenceText: `Evidence quality: TSS is recorded for ${formatCoverage(current.parentLoadCoverage.loadedCount, current.parentLoadCoverage.totalCount)} current workouts and ${formatCoverage(baselineMedian.parentLoadCoverage.loadedCount, baselineMedian.parentLoadCoverage.totalCount)} in the usual median.`,
    nextStepText: payload.topContributors.length && currentLoad !== null && usualLoad !== null
      ? 'Look at the top contributors below to see which workouts explain the change.'
      : null,
    coverageText: `Workout classification: ${current.childLoadCoverage.classifiedCount} classified, ${current.childLoadCoverage.unclassifiedCount} unclassified.`,
  };
}

function buildConclusion(current: number | null, usual: number | null): string {
  if (current === null || usual === null) {
    return 'There is not enough TSS coverage to make a complete load comparison yet.';
  }
  if (usual <= 0) {
    return current > 0
      ? 'Your current training has recorded load, but there is no usable usual-load reference yet.'
      : 'No recorded load is available in either comparison window.';
  }
  const delta = current - usual;
  if (Math.abs(delta) < 0.5) {
    return 'Your overall training load is close to your usual level.';
  }
  return `Your overall training load is ${delta > 0 ? 'higher' : 'lower'} than usual.`;
}

function resolveSportLoadDriver(current: DerivedTrainingExplanationSportLoad[], usual: DerivedTrainingExplanationSportLoad[]) {
  const currentBySport = new Map(current.map(item => [item.sport, item]));
  const usualBySport = new Map(usual.map(item => [item.sport, item]));
  return [...new Set([...currentBySport.keys(), ...usualBySport.keys()])]
    .flatMap((sport) => {
      const currentItem = currentBySport.get(sport);
      const usualItem = usualBySport.get(sport);
      if (currentItem?.trainingStressScore === null || usualItem?.trainingStressScore === null || !currentItem || !usualItem) {
        return [];
      }
      return [{
        label: currentItem.label,
        currentTss: currentItem.trainingStressScore,
        usualTss: usualItem.trainingStressScore,
        currentActivities: currentItem.activityCount,
        usualActivities: usualItem.activityCount,
      }];
    })
    .sort((left, right) => Math.abs(right.currentTss - right.usualTss) - Math.abs(left.currentTss - left.usualTss))[0] || null;
}

function resolveRhythmDriver(current: DerivedTrainingExplanationRhythm[], usual: DerivedTrainingExplanationRhythm[]) {
  const usualByDiscipline = new Map(usual.map(item => [item.discipline, item]));
  return current.flatMap((item) => {
    const usualItem = usualByDiscipline.get(item.discipline);
    if (!usualItem || !hasObservedRhythm(item, usualItem)) {
      return [];
    }
    return [{ current: item, usual: usualItem }];
  }).sort((left, right) => {
    const activeDayDeltaDifference = Math.abs(right.current.activeDayCount - right.usual.activeDayCount)
      - Math.abs(left.current.activeDayCount - left.usual.activeDayCount);
    if (activeDayDeltaDifference !== 0) {
      return activeDayDeltaDifference;
    }

    const observedActiveDaysDifference = totalObservedActiveDays(right) - totalObservedActiveDays(left);
    if (observedActiveDaysDifference !== 0) {
      return observedActiveDaysDifference;
    }

    const observedSessionsDifference = totalObservedSessions(right) - totalObservedSessions(left);
    if (observedSessionsDifference !== 0) {
      return observedSessionsDifference;
    }

    return left.current.discipline.localeCompare(right.current.discipline);
  })[0] || null;
}

function hasObservedRhythm(current: DerivedTrainingExplanationRhythm, usual: DerivedTrainingExplanationRhythm): boolean {
  return totalObservedActiveDays({ current, usual }) > 0 || totalObservedSessions({ current, usual }) > 0;
}

function totalObservedActiveDays({ current, usual }: { current: DerivedTrainingExplanationRhythm; usual: DerivedTrainingExplanationRhythm }): number {
  return current.activeDayCount + usual.activeDayCount;
}

function totalObservedSessions({ current, usual }: { current: DerivedTrainingExplanationRhythm; usual: DerivedTrainingExplanationRhythm }): number {
  return current.sessionCount + usual.sessionCount;
}

function formatLoadOutcome(current: number | null, usual: number | null): string {
  if (current === null || usual === null) return 'Coverage limited';
  if (usual <= 0) return current > 0 ? 'Load recorded' : 'No recorded load';
  const delta = current - usual;
  return Math.abs(delta) < 0.5
    ? 'At your usual load'
    : delta > 0 ? 'Above usual load' : 'Below usual load';
}
function formatRhythmOutcome(activeDayDelta: number): string {
  if (activeDayDelta === 0) return 'Same rhythm';
  return activeDayDelta > 0 ? 'More active days' : 'Fewer active days';
}
function formatCoverage(loaded: number, total: number): string { return `${loaded}/${total}`; }
function formatNumber(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value); }
function formatDiscipline(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
function formatDayCount(value: number): string { return `${formatNumber(value)} ${value === 1 ? 'day' : 'days'}`; }
function formatShortUtcDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value));
}
