import type { HealthChangeSignal } from '../../../helpers/health-change-summary.helper';
import type {
  DashboardTodayDirectionCue,
  DashboardTodayCueTone,
  DashboardTodayRangeIndicator,
  DashboardTodayHistoryBar,
} from '../../../helpers/dashboard-today-visuals.helper';

export type DashboardTodayReadinessTone = 'positive' | 'negative' | 'neutral';

export interface DashboardTodayReadinessViewModel {
  changeSignals: HealthChangeSignal[];
  loading: boolean;
  awaitingSleep: boolean;
  warningText: string;
  label: string;
  score: number | null;
  scoreText: string;
  confidenceText: string;
  evidenceText: string;
  availableSignalCount: number;
  loadText: string;
  formText: string;
  rampText: string;
  rampCue: DashboardTodayDirectionCue | null;
  scoreTone: DashboardTodayCueTone;
  sleepText: string;
  sleepDurationText: string | null;
  sleepScore: number | null;
  sleepContextText: string;
  hrvText: string;
  hrvStatusText: string;
  hrvRangeStatusText: string;
  hrvCue: DashboardTodayDirectionCue | null;
  hrvCueTone: DashboardTodayCueTone;
  hrvRangeText: string;
  hrvLatestText: string;
  hrvTone: DashboardTodayReadinessTone;
  hrvRangeIndicator: DashboardTodayRangeIndicator | null;
  overnightHeartRateText: string;
  overnightHeartRateReadingText: string | null;
  overnightHeartRateReadingKind: 'avg' | 'min' | null;
  overnightHeartRateCue: DashboardTodayDirectionCue | null;
  overnightHeartRateDeviationPercent: number | null;
  overnightHeartRateTone: DashboardTodayReadinessTone;
  overnightHeartRateContextText: string;
  recoveryText: string;
  recoveryStatusText?: string;
  recoveryRemainingPercent: number | null;
  recoveryFinishTimeMs: number | null;
  recoveryFinishText: string;
  loadBars: DashboardTodayHistoryBar[];
  overnightHeartRateBars: DashboardTodayHistoryBar[];
}

export interface DashboardTodayTrainingStateViewModel {
  label: string;
  caption: string;
  scalePosition: number | null;
  scaleTone: DashboardTodayReadinessTone;
  contextText?: string;
}
