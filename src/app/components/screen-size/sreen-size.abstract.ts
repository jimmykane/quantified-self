import {
  ChangeDetectorRef,
  HostListener,
  Inject,
} from '@angular/core';
import {UnitBasedAbstract} from '../unit-based/unit-based.abstract';
import {LoadingAbstract} from '../loading/loading.abstract';

/**
 * Class for handling screensize change and calling screen change event with no change detection
 */
export abstract class ScreenSizeAbstract extends LoadingAbstract {

  private screenWidth: number;
  private screenHeight: number;

  constructor(changeDetector: ChangeDetectorRef) {
    super(changeDetector);
  }

  @HostListener('window:resize', ['$event'])
  protected screenSizeChange(event?) {
    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;
  }


  protected getScreenWidthBreakPoint(): ScreenBreakPoints {
    if (this.screenWidth < 1120) {
      return ScreenBreakPoints.veryHigh
    }

    if (this.screenWidth < 1060) {
      return ScreenBreakPoints.high
    }

    if (this.screenWidth < 960) {
      return ScreenBreakPoints.moderate
    }

    if (this.screenWidth < 850) {
      return ScreenBreakPoints.low
    }

    if (this.screenWidth < 740) {
      return ScreenBreakPoints.veryLow
    }

    if (this.screenWidth < 640) {
      return ScreenBreakPoints.lowest
    }
  }
}

export enum ScreenBreakPoints {
  veryHigh,
  high,
  moderate,
  low,
  veryLow,
  lowest
}
