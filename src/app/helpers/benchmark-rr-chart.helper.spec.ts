import { describe, expect, it } from 'vitest';
import { analyzeRRIntervals, DistanceUnits } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import { buildRRPoincareChartOptions, buildRRPoincareSeries } from './benchmark-rr-poincare.helper';
import { buildBenchmarkRRChartOptions, buildBenchmarkRRSeries } from './benchmark-rr-chart.helper';

function analysis() {
  return analyzeRRIntervals([{ time:800, interval:800 }, { time:1600, interval:800 }, { time:4000, interval:800 }], 5000)!;
}
function recording(durationMs = 5000) {
  return { key: 'strap', label: 'Strap', analysis: analysis(), startTimeMs: 0, durationMs, color: '#123456', lineStyle: 'solid' as const };
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
      const result=buildBenchmarkRRChartOptions({recordings:[recording()],excludeFlagged:false,darkTheme:false,artifactColor:'#654321',width:320,unitSettings:{...getDefaultUserUnitSettings(),distanceUnits},zoom:{start:20,end:80}});
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
    const result = buildBenchmarkRRChartOptions({ recordings: [recording(300000)], excludeFlagged: false,
      darkTheme: false, artifactColor: '#654321', width: 600 });
    const axis = result.rr.xAxis as { axisLabel: { formatter: (value: number) => string }; axisPointer: { label: { formatter: (params: { value: number }) => string } } };
    expect(axis.axisLabel.formatter(123456)).toBe('02m');
    expect(axis.axisPointer.label.formatter({ value: 123456 })).toBe('02m 03s');
  });

  it('does not turn a missing tooltip value into a recorded zero', () => {
    const result = buildBenchmarkRRChartOptions({ recordings: [recording()], excludeFlagged: false,
      darkTheme: true, artifactColor: '#654321', width: 320 });
    for (const option of [result.rr, result.dfa]) {
      const tooltip = option.tooltip as { valueFormatter: (value: unknown) => string };
      for (const value of [null, undefined, '', false, NaN, Infinity]) expect(tooltip.valueFormatter(value)).toBe('Unavailable');
      expect(tooltip.valueFormatter(0)).not.toBe('Unavailable');
    }
  });

  it('overlays three recordings with stable IDs, device styles and original start offsets on one domain', () => {
    const first = recording();
    first.analysis.beats[0].classification = 'short';
    const recordings = [first,
      { ...recording(7000), key: 'watch', label: 'Watch', startTimeMs: 1000, color: '#654321', lineStyle: 'dashed' as const },
      { ...recording(), key: 'ring', label: 'Ring', startTimeMs: -2000, lineStyle: 'dotted' as const }];
    const before = JSON.stringify(recordings);
    const result = buildBenchmarkRRChartOptions({ recordings, excludeFlagged: false, darkTheme: false, artifactColor: '#FFA500', width: 800 });
    expect(result.rr.series).toHaveLength(9);
    expect(result.dfa.series).toHaveLength(3);
    expect(result.rr.xAxis).toMatchObject({ min: 0, max: 10000 });
    expect(result.dfa.xAxis).toEqual(result.rr.xAxis);
    expect(result.rr.series?.[0]).toMatchObject({ id: 'strap:rr', name: 'Strap · R–R interval', data: [[2800,800],[3600,800],[6000,null],[6000,800]] });
    expect(result.rr.series?.[1]).toMatchObject({ data: [[2800,800]] });
    expect(result.rr.series?.[3]).toMatchObject({ id: 'watch:rr', data: [[3800,800],[4600,800],[7000,null],[7000,800]], lineStyle: { color: '#654321', type: 'dashed' } });
    expect(result.dfa.series?.[1]).toMatchObject({ id: 'watch:dfa', data: [[8000,null]] });
    expect(result.rr.series?.[6]).toMatchObject({ lineStyle: { type: 'dotted' } });
    expect(result.dfa.series?.[1].markLine).toBeUndefined();
    expect(JSON.stringify(recordings)).toBe(before);
    const hidden = buildBenchmarkRRChartOptions({ recordings, excludeFlagged: true, darkTheme: true, artifactColor: '#FFA500', width: 320 });
    expect(hidden.rr.series?.[0].data?.[0]).toEqual([2800,null]);
    expect(hidden.rr.series?.[1].data).toEqual([]);
  });
});


describe('Poincaré interval pairs', () => {
  it('pairs only original adjacent intervals and never joins segment boundaries or invalid observations', () => {
    const input = analysis();
    expect(buildRRPoincareSeries(input, false).points.accepted).toEqual([{value:[800,800],time:800,kind:'accepted'}]);
    for (const invalid of [NaN,Infinity,0,-1]) {
      input.beats = [800,810,invalid,820,830].map((interval,index)=>({interval,time:index*1000,segment:0,classification:'accepted'}));
      expect(buildRRPoincareSeries(input,false).points.accepted.map(p=>p.value)).toEqual([[800,810],[820,830]]);
    }
    input.beats[1].time=0;
    expect(buildRRPoincareSeries(input,false).points.accepted.map(p=>p.value)).toEqual([[820,830]]);
  });
  it('flags either interval, gives artifact flags precedence and excludes pairs without joining neighbours', () => {
    const input=analysis();
    input.beats=[800,810,500,900,820,830].map((interval,index)=>({interval,time:index*1000,segment:0,
      classification:index===2?'short':index===3?'suspected-ectopic':'accepted'}));
    const before=JSON.stringify(input), visible=buildRRPoincareSeries(input,false),hidden=buildRRPoincareSeries(input,true);
    expect(visible.points.artifact.map(p=>p.value)).toEqual([[810,500],[500,900]]);
    expect(visible.points['suspected-ectopic'].map(p=>p.value)).toEqual([[900,820]]);
    expect(hidden.points.accepted.map(p=>p.value)).toEqual([[800,810],[820,830]]);
    expect(hidden.pairCount).toBe(2);expect(visible.pairCount).toBe(5);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('bounds every point category across the whole recording, retaining ends and unsampled extents', () => {
    const input=analysis(); input.beats=Array.from({length:10001},(_,i)=>({time:i+1,interval:i===5001?1800:800,segment:0,classification:'accepted'}));
    const result=buildRRPoincareSeries(input,false);
    expect(result.points.accepted).toHaveLength(4000);expect(result.pairCount).toBe(10000);expect(result.sampled).toBe(true);
    expect(result.points.accepted[0].time).toBe(1);expect(result.points.accepted.at(-1)?.time).toBe(10000);expect(result.max).toBe(1800);
  });
  it.each([DistanceUnits.Kilometers,DistanceUnits.Miles])('uses equal axes and square geometry with canonical tooltips (%s)', distanceUnits => {
    const source={...recording(),label:'<img src=x onerror=alert(1)>'};
    const result=buildRRPoincareChartOptions({recordings:[source,{...recording(),key:'watch',label:'Watch',startTimeMs:1000,lineStyle:'dashed'}],
      excludeFlagged:false,darkTheme:true,artifactColor:'#654321',width:320,height:330,unitSettings:{...getDefaultUserUnitSettings(),distanceUnits}});
    expect(result.option.backgroundColor).toBe('transparent');
    expect(result.option.xAxis.axisLabel).toMatchObject({showMinLabel:false,showMaxLabel:false,hideOverlap:true});
    expect(result.option.yAxis.axisLabel).toMatchObject({showMinLabel:false,showMaxLabel:false,hideOverlap:true});
    expect(result.option.grid.width).toBe(result.option.grid.height);
    expect(result.option.xAxis.min).toBe(result.option.yAxis.min);expect(result.option.xAxis.max).toBe(result.option.yAxis.max);
    expect(result.option.xAxis.name).toBe('Current R–R interval (ms)');expect(result.option.yAxis.name).toBe('Next R–R interval (ms)');
    expect(result.series).toHaveLength(6);expect(result.series[0].points[0].time).toBe(800);expect(result.series[3].points[0].time).toBe(1800);
    const tooltip=result.option.tooltip as {formatter:(p:unknown)=>string};
    expect(tooltip.formatter({seriesId:result.series[0].id,dataIndex:0})).toContain('Current: 800.0 ms');
    expect(tooltip.formatter({seriesId:result.series[0].id,dataIndex:0})).toContain('&lt;img');
    expect(tooltip.formatter({seriesId:result.series[0].id,dataIndex:0})).not.toContain('<img');
    expect(tooltip.formatter(null)).toBe('');expect(tooltip.formatter({seriesId:'unknown'})).toBe('');
  });
  it('does not use a backward-time observation in either adjacent pair', () => {
    const input=analysis();
    input.beats=[1000,500,2000,3000].map((time,index)=>({time,interval:800+index,segment:0,classification:'accepted'}));
    expect(buildRRPoincareSeries(input,false).points.accepted.map(point=>point.value)).toEqual([[802,803]]);
  });
  it('bounds both flagged categories independently while retaining their complete counts', () => {
    for (const classification of ['short','suspected-ectopic'] as const) {
      const input=analysis();input.beats=Array.from({length:10001},(_,index)=>({time:index+1,interval:800,segment:0,classification}));
      const result=buildRRPoincareSeries(input,false),points=result.points[classification==='short'?'artifact':'suspected-ectopic'];
      expect(points).toHaveLength(4000);expect(points[0].time).toBe(1);expect(points.at(-1)?.time).toBe(10000);
      expect(result.pairCount).toBe(10000);expect(result.sampled).toBe(true);
    }
  });
  it('keeps empty/one-beat plots finite and empty, with no invented zero pair', () => {
    const source=recording();source.analysis.beats=source.analysis.beats.slice(0,1);
    const result=buildRRPoincareChartOptions({recordings:[source],excludeFlagged:false,darkTheme:false,artifactColor:'#654321',width:320,height:330});
    expect(result.pairCount).toBe(0);expect(result.series.every(s=>!s.points.length)).toBe(true);
    expect(result.option.xAxis).toMatchObject({min:0,max:1});expect(result.flagged).toEqual([]);
  });
});
