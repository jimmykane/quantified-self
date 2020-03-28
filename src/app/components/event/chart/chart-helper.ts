import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';


export abstract class ChartHelper {
  static getWaterMark(waterMarkText: string): am4core.Label {
    const watermark = new am4core.Label();
    watermark.text = waterMarkText || 'Quantified-Self.io';
    watermark.align = 'right';
    watermark.valign = 'bottom';
    watermark.fontSize = '1.6em';
    watermark.opacity = 0.8;
    watermark.marginRight = 15;
    watermark.marginBottom = 15;
    watermark.zIndex = 100;
    watermark.filters.push(this.getShadowFilter());
    return watermark;
  }

  static getShadowFilter(size: number = 1): am4core.DropShadowFilter {
    const shadow = new am4core.DropShadowFilter();
    shadow.dx = size;
    shadow.dy = size;
    return shadow
  }

  static setYAxesToStack(chart: am4charts.XYChart) {
    chart.leftAxesContainer.layout = 'vertical';
    chart.leftAxesContainer.reverseOrder = false;
  }

  static unsetYAxesToStack(chart) {
    chart.leftAxesContainer.layout = 'horizontal';
    chart.leftAxesContainer.reverseOrder = true;
  }
}

export interface LabelData {
  name: string,
  average: { value: string, unit: string },
  min: { value: string, unit: string },
  max: { value: string, unit: string },
  gain?: { value: string, unit: string },
  loss?: { value: string, unit: string },
  minToMaxDiff?: { value: string, unit: string },
  slopePercentage?: { value: string, unit: string },
}
