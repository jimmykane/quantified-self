import { describe, expect, it, vi } from 'vitest';
import {
  EventImporterJSON, ActivityTypes, DataIBI, DataRRArtifactCount, DataRRArtifactPercentage,
  DataRRCoverage, DataRRRMSSD, DataRRDFAAlpha1Median, DataRRDFAAlpha1Min, DataRRDFAAlpha1Max,
  DataRRSDNN, DataRRPNN50, DataRRSuspectedEctopicPairCount, DataRRSuspectedEctopicPairRate,
  IBIStream, Stream, DistanceUnits,
} from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import {
  BENCHMARK_RR_METRICS, buildBenchmarkRRAnalysisInput, buildBenchmarkRRRows,
  formatBenchmarkRRValue, getBenchmarkRRIntervalSource, getBenchmarkRRLabels, hasBenchmarkRRStats,
  buildRRStatSummary,
  buildBenchmarkRRReportRows,
} from './benchmark-rr.helper';

function recording(name = 'Strap') {
  const activity = EventImporterJSON.getActivityFromJSON({
    name: '', startDate: 0, endDate: 10000, powerMeter: false, trainer: false,
    type: ActivityTypes.Running, creator: { name, devices: [] }, stats: {}, streams: [], laps: [], events: [], intensityZones: [],
  });
  activity.creator.name = name;
  return activity;
}

describe('benchmark R–R summaries', () => {
  it('includes the seven key report metrics with per-recording quality context', () => {
    const reference = recording(), test = recording('Watch');
    for (const activity of [reference, test]) {
      activity.addStat(new DataRRCoverage(100));
      activity.addStat(new DataRRArtifactPercentage(0));
      activity.addStat(new DataRRArtifactCount(0));
      activity.addStat(new DataRRSuspectedEctopicPairCount(0));
      activity.addStat(new DataRRSuspectedEctopicPairRate(0));
      activity.addStat(new DataRRRMSSD(20));
      activity.addStat(new DataRRSDNN(30));
      activity.addStat(new DataRRPNN50(10));
      activity.addStat(new DataRRDFAAlpha1Median(.62));
      activity.addStat(new DataRRDFAAlpha1Min(.09));
      activity.addStat(new DataRRDFAAlpha1Max(1.38));
    }
    const rows = buildBenchmarkRRReportRows(reference, test);
    expect(rows.map(row => row.type)).toEqual(BENCHMARK_RR_METRICS.filter(metric => metric.primary).map(metric => metric.type));
    expect(rows.find(row => row.type === DataRRArtifactPercentage.type)?.cells[0].detail).toBe('0 flagged intervals');
    expect(rows.find(row => row.type === DataRRSuspectedEctopicPairCount.type)?.cells[0].detail)
      .toBe(formatBenchmarkRRValue(DataRRSuspectedEctopicPairRate.type, 0)?.text);
    expect(rows.find(row => row.type === DataRRDFAAlpha1Median.type)?.cells[0].detail).toBe('Range 0.09–1.38');
    expect(rows.every(row => row.difference?.percent === 0)).toBe(true);
  });

  it('omits unavailable report rows and differences without replacing one-sided or invalid values with zero', () => {
    const reference = recording(), test = recording('Watch');
    reference.addStat(new DataRRArtifactPercentage(0));
    reference.addStat(new DataRRRMSSD(20));
    const invalid = new DataRRRMSSD(30);
    vi.spyOn(invalid, 'getValue').mockReturnValue(NaN);
    test.addStat(invalid);
    const rows = buildBenchmarkRRReportRows(reference, test);
    expect(rows.map(row => row.type)).toEqual([DataRRArtifactPercentage.type, DataRRRMSSD.type]);
    expect(rows[0].cells[0].display).toBe('0.0 %');
    expect(rows.every(row => row.cells[1].display === null && row.difference === null)).toBe(true);
    expect(buildBenchmarkRRReportRows(recording(), recording())).toEqual([]);
  });

  it('formats report comparisons canonically for default and imperial preferences without reading streams or mutating sources', () => {
    const reference = recording(), test = recording('Watch');
    reference.addStat(new DataRRRMSSD(20)); test.addStat(new DataRRRMSSD(30));
    const sourceBefore = [reference, test].map(activity => JSON.stringify(activity.toJSON()));
    const readReferenceStreams = vi.spyOn(reference, 'getAllStreams');
    const readTestStreams = vi.spyOn(test, 'getAllStreams');
    const defaults = getDefaultUserUnitSettings();
    for (const settings of [defaults, { ...defaults, distanceUnits: DistanceUnits.Miles }]) {
      const [row] = buildBenchmarkRRReportRows(reference, test, settings);
      expect(row.cells.map(cell => cell.display)).toEqual(['20.0 ms', '30.0 ms']);
      expect(row.difference).toEqual({ display: '10.0 ms', percent: 40 });
    }
    expect(readReferenceStreams).not.toHaveBeenCalled(); expect(readTestStreams).not.toHaveBeenCalled();
    expect([reference, test].map(activity => JSON.stringify(activity.toJSON()))).toEqual(sourceBefore);
  });

  it.each([
    [-.1, .1, '0.20', 200],
    [-.1, .2, '0.30', 200],
    [-.1, -.2, '0.10', 200 / 3],
    [0, 0, '0.00', 0],
  ])('compares valid signed DFA values without treating a zero mean as equality (%s, %s)', (a, b, display, percent) => {
    const reference = recording(), test = recording('Watch');
    reference.addStat(new DataRRDFAAlpha1Median(a));
    test.addStat(new DataRRDFAAlpha1Median(b));
    const [row] = buildBenchmarkRRReportRows(reference, test);
    expect(row.cells.every(cell => cell.display !== null)).toBe(true);
    expect(row.difference?.display).toBe(display);
    expect(row.difference?.percent).toBeCloseTo(percent);
    expect(buildBenchmarkRRReportRows(test, reference)[0].difference?.percent).toBeCloseTo(percent);
  });

  it('groups only valid saved R–R statistics, preserving zero and the original stat instances', () => {
    const zero = new DataRRArtifactPercentage(0), rmssd = new DataRRRMSSD(8.14), count = new DataRRArtifactCount(0);
    const invalid = new DataRRCoverage(100);
    vi.spyOn(invalid, 'getValue').mockReturnValue(NaN);
    const input = [zero, rmssd, count, invalid];
    const summary = buildRRStatSummary(input);
    expect(summary.primaryTypes).toEqual([zero.getType(), rmssd.getType()]);
    expect(summary.detailTypes).toEqual([count.getType()]);
    expect(summary.stats).toEqual([zero, rmssd, count]);
    expect(summary.stats[0]).toBe(zero); expect(input).toHaveLength(4);
  });

  it('shows secondary-only saved metrics immediately, and keeps missing statistics empty', () => {
    const count = new DataRRArtifactCount(0);
    expect(buildRRStatSummary([count])).toEqual({ stats: [count], primaryTypes: [count.getType()], detailTypes: [] });
    expect(buildRRStatSummary([])).toEqual({ stats: [], primaryTypes: [], detailTypes: [] });
  });

  it('keeps source values separate, with missing values distinct from recorded zero', () => {
    const a = recording(), b = recording('Watch');
    a.addStat(new DataRRCoverage(100)); a.addStat(new DataRRArtifactPercentage(0)); a.addStat(new DataRRArtifactCount(0));
    const rows = buildBenchmarkRRRows([a, b], [DataRRCoverage.type, DataRRArtifactPercentage.type]);
    expect(rows[0].cells).toEqual([{ display: '100.0 %', detail: null }, { display: null, detail: null }]);
    expect(rows[1].cells).toEqual([{ display: '0.0 %', detail: '0 flagged intervals' }, { display: null, detail: null }]);
    expect(hasBenchmarkRRStats(a)).toBe(true); expect(hasBenchmarkRRStats(b)).toBe(false);
  });

  it('formats the same canonical R–R values for default and non-default distance preferences', () => {
    const defaults = getDefaultUserUnitSettings();
    const imperial = { ...defaults, distanceUnits: DistanceUnits.Miles };
    for (const settings of [defaults, imperial]) {
      expect(formatBenchmarkRRValue(DataRRRMSSD.type, 8.14, settings)?.text).toBe('8.1 ms');
      expect(formatBenchmarkRRValue(DataRRDFAAlpha1Median.type, .624, settings)?.text).toBe('0.62');
    }
  });

  it('formats the DFA range and never coerces missing, invalid or string input to zero', () => {
    const a = recording();
    a.addStat(new DataRRDFAAlpha1Median(.62)); a.addStat(new DataRRDFAAlpha1Min(.09)); a.addStat(new DataRRDFAAlpha1Max(1.38));
    expect(buildBenchmarkRRRows([a], [DataRRDFAAlpha1Median.type])[0].cells[0].detail).toBe('Range 0.09–1.38');
    for (const value of [null, undefined, NaN, Infinity, '0', -1]) expect(formatBenchmarkRRValue(DataRRRMSSD.type, value)).toBeNull();
    expect(formatBenchmarkRRValue(DataRRCoverage.type, 101)).toBeNull();
    expect(new Set(BENCHMARK_RR_METRICS.map(metric => metric.type)).size).toBe(20);
  });

  it('preserves irregular end times and invalid-observation barriers without changing the stream', () => {
    const a = recording(); const stream = new IBIStream([800, null, 900], [800, 1600, 5900]); a.addStream(stream);
    const before = JSON.stringify(stream.toJSON());
    const input = buildBenchmarkRRAnalysisInput(a)!;
    expect(input.durationMs).toBe(10000);
    expect(input.samples).toEqual([{ time:800, interval:800 }, { time:1600, interval:NaN }, { time:5900, interval:900 }]);
    expect(JSON.stringify(stream.toJSON())).toBe(before);
  });

  it('rejects resampled IBI and invalid recording durations', () => {
    const a = recording(); a.addStream(new Stream(DataIBI.type, [800, 900]));
    expect(buildBenchmarkRRAnalysisInput(a)).toBeNull();
    const b = recording(); b.addStream(new IBIStream([800])); b.endDate = new Date(0);
    expect(buildBenchmarkRRAnalysisInput(b)).toBeNull();
  });

  it('ignores display filters and reads original timing only when requested', () => {
    const a = recording();
    const stream = new IBIStream([800, 900], [800, 5000]);
    const filterData = vi.fn(() => []);
    stream.useFilter({ filterData }); a.addStream(stream);
    const readTiming = vi.spyOn(stream, 'getStreamDataByDuration');
    expect(getBenchmarkRRIntervalSource(a)).toEqual({ stream, durationMs: 10000 });
    expect(readTiming).not.toHaveBeenCalled(); expect(filterData).not.toHaveBeenCalled();
    expect(buildBenchmarkRRAnalysisInput(a)?.samples).toEqual([{ time: 800, interval: 800 }, { time: 5000, interval: 900 }]);
    expect(filterData).not.toHaveBeenCalled(); expect(stream.hasFilter()).toBe(true);
  });

  it('disambiguates repeated device labels and labels unnamed recordings', () => {
    expect(getBenchmarkRRLabels([recording('Strap'), recording('Strap'), recording('')])).toEqual(['Strap (1)', 'Strap (2)', 'Recording 3']);
  });
});
