import { Injectable, inject } from '@angular/core';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { projectLoadedHealthRange } from '@shared/health-query';
import type { TimelineNote } from '@shared/timeline-notes';
import { buildHealthMetricWorkspaceView, type HealthWorkspaceSeries } from '../helpers/health-workspace.helper';
import { addComparisonDays, comparisonDateCarrier, noteComparisonWindow,
  type NoteComparisonDays, type NoteComparisonMetric, type NoteComparisonWindow } from '../helpers/timeline-note-comparison.helper';
import { HealthMetricQueryService } from './health-metric-query.service';
import type { HealthWorkspaceRangeLoad } from './app.health.service';

export interface TimelineNoteComparisonEvidence {
  window: NoteComparisonWindow;
  series: HealthWorkspaceSeries[];
  complete: Record<NoteComparisonMetric, boolean>;
  notices: string[];
}

/** Read-only composition of the existing owner-scoped Health and normalized Sleep paths. */
@Injectable({ providedIn: 'root' })
export class TimelineNoteComparisonService {
  private readonly queries = inject(HealthMetricQueryService);
  async load(uid: string, note: TimelineNote, days: NoteComparisonDays, signal: AbortSignal,
    nowMs = Date.now()): Promise<TimelineNoteComparisonEvidence> {
    const current = () => this.queries.isOwner(uid) && !signal.aborted;
    if (!current()) throw new Error('Comparison account changed or view closed.');
    const window = noteComparisonWindow(note, days, nowMs);
    const startDate = window.before.startDate;
    const endDate = window.after.endDate < window.today ? window.after.endDate : addComparisonDays(window.today, -1);
    if (endDate < startDate) return { window, series: [], complete: {
      sleep_duration: true, heart_rate_variability: true, resting_heart_rate: true,
    }, notices: [] };
    const request = (metricId: 'heart_rate_variability' | 'resting_heart_rate') =>
      this.queries.loadMetricRange(uid, { metricId, startDate, endDate, includeSamples: false }, 100, signal);
    // Adjacent-date envelope protects nights crossing provider/viewer calendar boundaries. Projection uses recorded dates.
    const [hrvRead, rhrRead, sleepRead] = await Promise.allSettled([
      request(HEALTH_METRIC_IDS.HeartRateVariability), request(HEALTH_METRIC_IDS.RestingHeartRate),
      this.queries.loadSleepSummaryRange(uid, comparisonDateCarrier(addComparisonDays(startDate, -1)) - 12 * 3_600_000,
        Math.min(nowMs, comparisonDateCarrier(addComparisonDays(endDate, 1)) + 12 * 3_600_000 - 1), 100, signal),
    ]);
    if (!current()) throw new Error('Comparison account changed or view closed.');
    const hrv = hrvRead.status === 'fulfilled' ? hrvRead.value : null;
    const rhr = rhrRead.status === 'fulfilled' ? rhrRead.value : null;
    const sleep = sleepRead.status === 'fulfilled' ? sleepRead.value : null;
    const sessions = sleep?.sessions || [];
    const completeHealth = (read: HealthWorkspaceRangeLoad | null) => !!read && !read.limitReached
      && read.result.pageInfo.sourceRecordAggregateComplete;
    const empty = (metricId: NoteComparisonMetric) => projectLoadedHealthRange([], [],
      { startDate, endDate, metricIds: [metricId], includeSamples: false },
      { sourceRecordsComplete: true, samplesComplete: true });
    const series = [
      ...buildHealthMetricWorkspaceView(empty(HEALTH_METRIC_IDS.SleepDuration), sessions).series,
      ...buildHealthMetricWorkspaceView(hrv?.result || empty(HEALTH_METRIC_IDS.HeartRateVariability), sessions).series,
      // Sleep resting HR must never stand in for a daily resting HR summary.
      ...buildHealthMetricWorkspaceView(rhr?.result || empty(HEALTH_METRIC_IDS.RestingHeartRate)).series,
    ];
    const complete = { sleep_duration: !!sleep?.complete,
      heart_rate_variability: completeHealth(hrv) && !!sleep?.complete, resting_heart_rate: completeHealth(rhr) };
    const notices = [!complete.sleep_duration ? 'Sleep readings failed or reached the bounded read limit.' : '',
      !completeHealth(hrv) ? 'Nightly HRV readings failed or reached the bounded read limit.' : '',
      !complete.resting_heart_rate ? 'Daily resting heart-rate readings failed or reached the bounded read limit.' : ''].filter(Boolean);
    return { window, series, complete, notices };
  }
}
