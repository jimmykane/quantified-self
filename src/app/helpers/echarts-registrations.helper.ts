import { BarChart, PictorialBarChart, CustomChart, PieChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  GraphicComponent, GridComponent, TooltipComponent, LegendComponent, TitleComponent, AxisPointerComponent,
  MarkLineComponent, MarkPointComponent, MarkAreaComponent, VisualMapComponent, ToolboxComponent, DataZoomComponent, BrushComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

/** Keep named imports behind the loader's lazy boundary. Dynamic imports of the
 * package namespaces retain every chart/component/renderer in the browser build,
 * even when registration selects only these features. */
export function registerEChartsModules(core: Pick<typeof import('echarts/core'), 'use'>): void {
  core.use([
    BarChart, PictorialBarChart, CustomChart, PieChart, LineChart, ScatterChart,
    GraphicComponent, GridComponent, TooltipComponent, LegendComponent, TitleComponent, AxisPointerComponent,
    MarkLineComponent, MarkPointComponent, MarkAreaComponent, VisualMapComponent, ToolboxComponent, DataZoomComponent, BrushComponent,
    CanvasRenderer,
  ]);
}
