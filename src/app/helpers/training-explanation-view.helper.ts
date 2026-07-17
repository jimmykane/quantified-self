import type {
  DerivedTrainingExplanationMetricPayload,
  DerivedTrainingExplanationRhythm,
  DerivedTrainingExplanationSportLoad,
} from '@shared/derived-metrics';

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
    valueText: formatLoadDelta(currentLoad, usualLoad),
    description: currentLoad === null
      ? `No parent-event TSS is available for this 28-day window (${current.parentLoadEventCount}/${current.parentEventCount} events with load).`
      : `${formatNumber(currentLoad)} TSS across ${current.parentEventCount} parent events${usualLoad === null ? '; the usual load baseline is unavailable.' : `, compared with a ${formatNumber(usualLoad)} TSS median for the prior three blocks.`}`,
    tone: 'neutral',
  }];

  if (payload.topContributors.length) {
    const contributors = payload.topContributors.slice(0, 3);
    const descriptionItems = contributors.map((item) => {
      const leadingChild = [...item.childComposition]
        .filter(child => child.loadSharePercent !== null)
        .sort((left, right) => (right.loadSharePercent || 0) - (left.loadSharePercent || 0))[0];
      const usesContextFallback = isGenericContributorLabel(item.label);
      const label = usesContextFallback
        ? `${leadingChild?.label || 'Activity'} · ${formatShortUtcDate(item.startDayMs)}`
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
      valueText: formatHigherLowerChange(sportDriver.currentTss, sportDriver.usualTss, ' TSS'),
      description: `${formatNumber(sportDriver.currentTss)} TSS now versus ${formatNumber(sportDriver.usualTss)} usual; ${sportDriver.currentActivities} activities now versus ${sportDriver.usualActivities} usual.`,
      tone: 'neutral',
    });
  }

  const rhythmDriver = resolveRhythmDriver(current.rhythms, baselineMedian.rhythms);
  if (rhythmDriver) {
    const delta = rhythmDriver.current.activeDayCount - rhythmDriver.usual.activeDayCount;
    cards.push({
      key: 'rhythm',
      title: `${formatDiscipline(rhythmDriver.current.discipline)} rhythm`,
      valueText: formatHigherLowerChange(
        rhythmDriver.current.activeDayCount,
        rhythmDriver.usual.activeDayCount,
        Math.abs(delta) === 1 ? ' active day' : ' active days',
      ),
      description: `${rhythmDriver.current.sessionCount} sessions across ${rhythmDriver.current.activeWeekCount} active weeks. Longest inactivity gap: ${formatDayCount(rhythmDriver.current.longestInactivityGapDays)}; usual is ${formatDayCount(rhythmDriver.usual.longestInactivityGapDays)}.`,
      tone: 'neutral',
    });
  }

  return {
    cards,
    coverageText: `Load coverage: ${formatCoverage(current.parentLoadCoverage.loadedCount, current.parentLoadCoverage.totalCount)} current parent events and ${formatCoverage(baselineMedian.parentLoadCoverage.loadedCount, baselineMedian.parentLoadCoverage.totalCount)} in the usual median. Activity classification: ${current.childLoadCoverage.classifiedCount} classified, ${current.childLoadCoverage.unclassifiedCount} unclassified.`,
  };
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
    return usualItem ? [{ current: item, usual: usualItem }] : [];
  }).sort((left, right) => (
    Math.abs(right.current.activeDayCount - right.usual.activeDayCount)
    - Math.abs(left.current.activeDayCount - left.usual.activeDayCount)
  ))[0] || null;
}

function formatLoadDelta(current: number | null, usual: number | null): string {
  if (current === null || usual === null) return 'Coverage limited';
  if (usual <= 0) return current > 0 ? `${formatNumber(current)} TSS now` : 'No recorded load';
  const delta = ((current - usual) / usual) * 100;
  return Math.abs(delta) < 0.5
    ? 'About usual'
    : `${formatNumber(Math.abs(delta))}% ${delta > 0 ? 'higher' : 'lower'} than usual`;
}
function formatHigherLowerChange(current: number, usual: number, suffix: string): string {
  const delta = current - usual;
  return delta === 0 ? `Same${suffix}` : `${formatNumber(Math.abs(delta))}${suffix} ${delta > 0 ? 'higher' : 'lower'}`;
}
function formatCoverage(loaded: number, total: number): string { return `${loaded}/${total}`; }
function formatNumber(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value); }
function formatDiscipline(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
function formatDayCount(value: number): string { return `${formatNumber(value)} ${value === 1 ? 'day' : 'days'}`; }
function formatShortUtcDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value));
}
function isGenericContributorLabel(value: string | null): boolean {
  const label = `${value || ''}`.trim();
  return !label || /^new event$/i.test(label) || /^\d{4}-\d{2}-\d{2}t/i.test(label);
}
