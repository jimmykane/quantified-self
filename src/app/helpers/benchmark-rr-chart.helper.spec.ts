import { describe, expect, it } from 'vitest';
import { analyzeRRIntervals, DistanceUnits } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import { buildBenchmarkRRChartOptions, buildBenchmarkRRSeries } from './benchmark-rr-chart.helper';

function analysis() {
  return analyzeRRIntervals([{ time:800, interval:800 }, { time:1600, interval:800 }, { time:4000, interval:800 }], 5000)!;
}

describe('benchmark R–R charts', () => {
  it('keeps per-beat times and inserts a line break across a recording gap', () => {
    const series = buildBenchmarkRRSeries(analysis(), false);
    expect(series.intervals).toEqual([[800,800], [1600,800], [4000,null], [4000,800]]);
    expect(series.dfa).toEqual([[5000,null]]);
  });
  it('keeps separate artifact and suspected-pair markers, and masks rather than repairs flagged beats', () => {
    const input = analysis(); input.beats[0].classification='short'; input.beats[1].classification='suspected-ectopic';
    const before=JSON.stringify(input);
    expect(buildBenchmarkRRSeries(input,false)).toMatchObject({ artifacts:[[800,800]],ectopics:[[1600,800]] });
    expect(buildBenchmarkRRSeries(input,true)).toMatchObject({ intervals:[[800,null],[1600,null],[4000,null],[4000,800]],artifacts:[],ectopics:[] });
    expect(JSON.stringify(input)).toBe(before);
  });
  it('bounds markers over the complete domain while retaining the first and last flagged beats', () => {
    const input=analysis();input.beats=Array.from({length:9000},(_,i)=>({time:i+1,interval:800,classification:'short',segment:0}));
    const result=buildBenchmarkRRSeries(input,false);
    expect(result.artifacts).toHaveLength(4000);expect(result.artifacts[0][0]).toBe(1);expect(result.artifacts.at(-1)?.[0]).toBe(9000);expect(result.markerSampling).toBe(true);
  });
  it('uses canonical display for default/non-default units, fixed full-recording bounds and preserved zoom', () => {
    for(const distanceUnits of [DistanceUnits.Kilometers,DistanceUnits.Miles]){
      const result=buildBenchmarkRRChartOptions({analysis:analysis(),durationMs:5000,excludeFlagged:false,darkTheme:false,color:'#123456',artifactColor:'#654321',width:320,unitSettings:{...getDefaultUserUnitSettings(),distanceUnits},zoom:{start:20,end:80}});
      const y=result.rr.yAxis as {name:string;formatter?:unknown;axisLabel:{formatter:(n:number)=>string};min:number;max:number};
      expect(y.name).toBe('ms');expect(y.axisLabel.formatter(800)).toBe('800.0');expect(y.min).toBeLessThan(800);expect(y.max).toBeGreaterThan(800);
      expect(result.rr.dataZoom?.[0]).toMatchObject({start:20,end:80,zoomOnMouseWheel:false});
      expect(result.rr.dataZoom?.[0].id).toBe(result.dfa.dataZoom?.[0].id);
      expect(result.rr.dataZoom?.[1].id).toBe(result.dfa.dataZoom?.[1].id);
      expect(result.dfa.dataZoom?.[1]).toMatchObject({show:false,start:20,end:80});
      expect(result.rr.series?.[0]).toMatchObject({connectNulls:false});
      expect(result.rr.series?.[0]).not.toHaveProperty('sampling');
    }
  });

  it('keeps seconds in hover timing while axis ticks stay compact', () => {
    const result = buildBenchmarkRRChartOptions({ analysis: analysis(), durationMs: 300000, excludeFlagged: false,
      darkTheme: false, color: '#123456', artifactColor: '#654321', width: 600 });
    const axis = result.rr.xAxis as { axisLabel: { formatter: (value: number) => string }; axisPointer: { label: { formatter: (params: { value: number }) => string } } };
    expect(axis.axisLabel.formatter(123456)).toBe('02m');
    expect(axis.axisPointer.label.formatter({ value: 123456 })).toBe('02m 03s');
  });

  it('does not turn a missing tooltip value into a recorded zero', () => {
    const result = buildBenchmarkRRChartOptions({ analysis: analysis(), durationMs: 5000, excludeFlagged: false,
      darkTheme: true, color: '#123456', artifactColor: '#654321', width: 320 });
    for (const option of [result.rr, result.dfa]) {
      const tooltip = option.tooltip as { valueFormatter: (value: unknown) => string };
      for (const value of [null, undefined, '', false, NaN, Infinity]) expect(tooltip.valueFormatter(value)).toBe('Unavailable');
      expect(tooltip.valueFormatter(0)).not.toBe('Unavailable');
    }
  });
});
