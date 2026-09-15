import { projectHealthRange } from '@shared/health-query';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { HEALTH_METRIC_IDS, type HealthProvider } from '@shared/health';
import type { ActivityHealthRangeResult } from '@shared/activity-health';
import { isActivityHealthMetricId } from '@shared/activity-health';
import { sleepEvidenceSourceKey } from '@shared/nightly-hrv';
import type { SleepSession } from '@shared/sleep';
import type { HealthWorkspaceRangeLoad } from '../services/app.health.service';
import type { AppDashboardHealthMetricSettings } from '../models/app-user.interface';
import { buildHealthMetricWorkspaceView, buildHealthHrvPersonalRangeStatus, selectActivityHealthObservations, selectWorkoutWeightContextFallback, type HealthWorkspaceWindow, type HealthWorkspaceSeries, formatHealthValue } from './health-workspace.helper';
import { buildHealthChartModels, buildHealthHrvChartStatusOverlay, healthHrvChartStatusDescription } from './health-metric-chart.helper';
import { buildDashboardSleepTrendContext, resolveSleepTrendDate } from './dashboard-sleep-chart.helper';
import type { DashboardChartAvailability } from './dashboard-chart-availability.helper';
export interface DashboardHealthEvidence {
    window: HealthWorkspaceWindow;
    health: HealthWorkspaceRangeLoad | null;
    history: HealthWorkspaceRangeLoad | null;
    activities: ActivityHealthRangeResult | null;
    sessions: SleepSession[];
    errors: string[];
    staleSources?: string[];
}
export function buildDashboardHealthContext(evidence: DashboardHealthEvidence, settings: AppDashboardHealthMetricSettings, units: UserUnitSettingsInterface | null = null, preferredAccount?: string, providerFilter: readonly HealthProvider[] = [], nowMs = Date.now()) {
    const { window, health, history, activities } = evidence;
    const sessions = evidence.sessions.filter(session => {
        const date = resolveSleepTrendDate(session);
        return date && date >= window.startDate && date <= window.endDate;
    });
    const result = health?.result || projectHealthRange([], [], { startDate: window.startDate, endDate: window.endDate, metricIds: settings.metric === 'sleep' ? [] : [settings.metric], includeSamples: window.includeSamples });
    const observations = activities && settings.metric !== 'sleep' && isActivityHealthMetricId(settings.metric)
        ? selectActivityHealthObservations(settings.metric, result, activities.observations) : [];
    // Source records can exist without a point the selected chart can draw (for
    // example a missing value, or a sample outside this window). Do not offer
    // those sources, or let them win the initial selection over real readings.
    const series = buildHealthMetricWorkspaceView(result, sessions, observations, units).series
        .map(series => ({ ...series, points: series.points.filter(point =>
            Number.isFinite(point.timestampMs) && point.timestampMs >= window.startTimeMs && point.timestampMs <= window.endTimeMs
            && (typeof point.value === 'number' ? Number.isFinite(point.value)
                : series.chartKind === 'step' && (typeof point.value === 'boolean' || typeof point.value === 'string' && point.value.trim().length > 0))) }))
        .filter(series => series.points.length > 0);
    const historySeries = history ? buildHealthMetricWorkspaceView(history.result, evidence.sessions, [], units).series : [];
    const charts = buildHealthChartModels(series, window.startTimeMs, window.endTimeMs, units).map(model => {
        const previous = historySeries.find(item => item.id === model.series.id);
        const points = new Map<string, HealthWorkspaceSeries['points'][number]>();
        for (const point of [...(previous?.points || []), ...model.series.points])
            points.set(`${point.timestampMs}:${point.calendarDate}`, point);
        // A failed/truncated baseline read must not masquerade as a complete personal range.
        const status = settings.metric === HEALTH_METRIC_IDS.HeartRateVariability && history && !history.limitReached
            ? buildHealthHrvPersonalRangeStatus({ ...model.series, points: [...points.values()].sort((a, b) => a.timestampMs - b.timestampMs) }, window.endTimeMs, units, model.series.points.map(point => point.timestampMs), window.startTimeMs, nowMs) : null;
        const latest = model.series.points.at(-1);
        return { key: model.series.id, model, status, statusOverlay: buildHealthHrvChartStatusOverlay(status), statusDescription: healthHrvChartStatusDescription(status),
            latestValueText: latest ? formatHealthValue(model.series.metricId, latest.value, model.series.unit, model.series.nativeOnly, units) : '—' };
    });
    const sleepSources = [...new Set(sessions.map(sleepEvidenceSourceKey))].sort().flatMap(key => {
        const session = sessions.find(item => sleepEvidenceSourceKey(item) === key)!;
        const context = buildDashboardSleepTrendContext(sessions.filter(item => sleepEvidenceSourceKey(item) === key));
        if (!context.hasRealPoints) return [];
        const provider = session.source.provider as HealthProvider;
        const label = context.latestPoint!.providerLabel;
        return [{ key, provider, label }];
    });
    const sources = settings.metric === 'sleep' ? sleepSources.map((source, index) => ({ ...source,
        label: sleepSources.filter(item => item.provider === source.provider).length > 1 ? `${source.label} · Account ${index + 1}` : source.label }))
        : charts.map(chart => ({ key: chart.key, provider: chart.model.series.provider, label: `${chart.model.series.sourceLabel} · ${chart.model.series.semanticLabel}` }));
    const initial = providerFilter.length
        ? sources.find(source => providerFilter.includes(source.provider))
        : (settings.metric === HEALTH_METRIC_IDS.HeartRateVariability && preferredAccount
            ? sources.find(source => charts.find(chart => chart.key === source.key)?.model.series.sourceSelectionKey === preferredAccount) : null) || sources[0];
    const missingFilteredSource = !settings.sourceKey && providerFilter.length > 0 && !initial;
    const selectedKey = settings.sourceKey || initial?.key || null;
    const selected = charts.find(chart => chart.key === selectedKey) || null;
    const sleep = buildDashboardSleepTrendContext(sessions.filter(session => sleepEvidenceSourceKey(session) === selectedKey), {
        sleepWindow: { startMs: window.startTimeMs, endMs: window.endTimeMs }, nowMs: window.endTimeMs,
    });
    const hasData = settings.metric === 'sleep' ? sleep.hasRealPoints === true : !!selected?.model.displayedPointCount;
    const missingSource = !!settings.sourceKey && !sources.some(source => source.key === settings.sourceKey);
    const sampleOnly = !window.includeSamples && !!health?.hasSampleBackedMetric && !hasData;
    const limited = !!health?.limitReached || activities?.complete === false;
    const notices = [...evidence.errors.map(source => evidence.staleSources?.includes(source)
        ? `${source} could not be refreshed. Previous readings are shown. Try again.`
        : `${source} could not be loaded. Try again.`),
        ...(limited ? ['Some readings could not fit in this view. Choose a shorter period to see more detail.'] : []),
        ...(health?.result.pageInfo.sampleRevisionMismatchCount ? ['Some readings are updating at their source. The available readings are shown.'] : [])];
    if (settings.metric === HEALTH_METRIC_IDS.BodyWeight && health && activities) {
        const fallback = selectWorkoutWeightContextFallback(health.result, activities.observations, [], units);
        if (fallback)
            notices.push(`Latest workout profile weight: ${fallback.valueText} · ${fallback.sourceLabel} · ${fallback.observedText}. This is profile context, not a weigh-in.`);
    }
    const unavailable = evidence.errors.length > 0 || limited;
    const availability: DashboardChartAvailability = {
        state: hasData ? 'ready' : unavailable ? 'error' : 'no-data', hasData,
        label: hasData ? 'Ready with your data' : unavailable ? 'Some data unavailable' : sampleOnly ? 'Choose a shorter period' : 'No data in this period',
        reason: hasData ? 'Recorded readings are available.' : missingFilteredSource ? 'No readings from the Health source filter in this period. Choose another source or period.' : missingSource ? 'The selected source and reading have no data in this period. Choose another period or source.'
            : sampleOnly ? 'Detailed readings are available without a daily summary. Choose 30 days or less.'
                : unavailable ? notices.join(' ') : 'No matching readings were found in this period.',
    };
    return { window, sources, selectedKey, selected, sleep, hasData, missingSource, sampleOnly, notices, failedSources: evidence.errors.length, availability };
}
export type DashboardHealthContext = ReturnType<typeof buildDashboardHealthContext>;
