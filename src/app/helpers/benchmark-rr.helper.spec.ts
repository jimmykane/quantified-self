import { describe, expect, it, vi } from 'vitest';
import {
  EventImporterJSON, ActivityTypes, DataIBI, DataRRArtifactCount, DataRRArtifactPercentage,
  DataRRCoverage, DataRRRMSSD, DataRRDFAAlpha1Median, DataRRDFAAlpha1Min, DataRRDFAAlpha1Max,
  IBIStream, Stream, DistanceUnits,
} from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import {
  BENCHMARK_RR_METRICS, buildBenchmarkRRAnalysisInput, buildBenchmarkRRRows,
  formatBenchmarkRRValue, getBenchmarkRRIntervalSource, getBenchmarkRRLabels, hasBenchmarkRRStats,
  buildRRStatSummary,
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
