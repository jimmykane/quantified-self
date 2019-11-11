import * as am4core from '@amcharts/amcharts4/core';

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
}
