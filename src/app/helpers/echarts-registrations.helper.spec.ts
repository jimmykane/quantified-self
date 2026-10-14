import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { BarChart, PictorialBarChart, CustomChart, PieChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  GraphicComponent, GridComponent, TooltipComponent, LegendComponent, TitleComponent, AxisPointerComponent,
  MarkLineComponent, MarkAreaComponent, VisualMapComponent, ToolboxComponent, DataZoomComponent, BrushComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { registerEChartsModules } from './echarts-registrations.helper';

describe('lazy ECharts named registrations', () => {
  it('retains the exact existing chart, component and renderer registrations without a DOM', () => {
    const use = vi.fn();
    expect(typeof document).toBe('undefined');
    registerEChartsModules({ use });
    expect(use).toHaveBeenCalledExactlyOnceWith([
      BarChart, PictorialBarChart, CustomChart, PieChart, LineChart, ScatterChart,
      GraphicComponent, GridComponent, TooltipComponent, LegendComponent, TitleComponent, AxisPointerComponent,
      MarkLineComponent, MarkAreaComponent, VisualMapComponent, ToolboxComponent, DataZoomComponent, BrushComponent,
      CanvasRenderer,
    ]);
  });
  it('propagates registration errors so the loader can retry instead of caching a partial result', () => {
    const failure = new Error('registration failed');
    const use = vi.fn(() => { throw failure; });
    expect(() => registerEChartsModules({ use })).toThrow(failure);
    expect(use).toHaveBeenCalledOnce();
  });
  it('keeps feature imports statically named behind the shared lazy loader', () => {
    const loader = readFileSync(new URL('../services/echarts-loader.service.ts', import.meta.url), 'utf8');
    const registrations = readFileSync(new URL('./echarts-registrations.helper.ts', import.meta.url), 'utf8');
    expect(loader).toContain("import('../helpers/echarts-registrations.helper')");
    const wholeFeatureNamespace = /\bimport\s*\(\s*['"]echarts\/(?:charts|components|renderers)['"]\s*\)/;
    expect(loader).not.toMatch(wholeFeatureNamespace);
    expect(registrations).not.toMatch(wholeFeatureNamespace);
    expect(registrations).not.toMatch(/\bimport\s+\*\s+as\s+\w+\s+from\s+['"]echarts\/(?:charts|components|renderers)['"]/);
  });
});
