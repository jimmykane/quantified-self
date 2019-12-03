import {
  ChangeDetectorRef,
  HostListener,
  Inject,
} from '@angular/core';
import {LoadingAbstract} from '../loading/loading.abstract';
import {ScreenBreakPoints, ScreenSizeAbstract} from '../screen-size/sreen-size.abstract';

export abstract class DataTableAbstract extends ScreenSizeAbstract {


  constructor(changeDetector: ChangeDetectorRef) {
    super(changeDetector);
  }

  getColumnsToDisplayDependingOnScreenSize() {

    // push all the rest
    let columns =[
      'expand',
      'checkbox',
      'startDate',
      'Activity Types',
      'Duration',
      'Distance',
      'Ascent',
      'Descent',
      'Energy',
      'Average Heart Rate',
      'Average Speed',
      'Average Power',
      'Device Names',
      'Actions'
    ];

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Highest) {
      return columns;
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.VeryHigh) {
      columns = columns.filter(column => ['Energy'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.High) {
      columns = columns.filter(column => ['Energy', 'Average Power'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Moderate) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'Descent'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Low) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'Descent', 'Device Names'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.VeryLow) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'Descent', 'Device Names', 'Ascent'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Lowest) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'Average Speed', 'Average Heart Rate', 'Descent', 'Device Names', 'Ascent', 'Descent'].indexOf(column) === -1)
    }

    return columns
  }
}
